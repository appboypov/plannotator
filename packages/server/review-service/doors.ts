/**
 * A door: a second listener that lets visitors from outside this Mac reach only the
 * Reviews whose Visibility is the door's, at the moment of each request (ADR 0007).
 * The public door binds the Tailscale address for the VPS (Caddy on
 * ctas.de-appspecialist.nl routes `/plannotator/*` to it). The rules are Lavish's:
 * - Only [peer] may connect: any other address is dropped before a byte is read.
 * - Only what `door-manifest.ts` lists passes; everything else, the review API and
 *   the listen socket included, answers 404, and every WebSocket upgrade is refused
 *   with 404.
 * - Only the door's hostnames are answered (`Host` and the last `X-Forwarded-Host`).
 * - Each visitor (the last `X-Forwarded-For` entry, the proxy's view) gets [limit]
 *   requests per window, then 429.
 * - Every answer forbids framing; the page's `api/plan` loses this Mac's paths, repo
 *   and git user, keeping only the document's file name.
 * - A Review whose Visibility changes away from the door's loses its open requests
 *   through the door at once (`revoke`).
 *
 * It is a `node:http` server, not `Bun.serve`, because only its `connection` event
 * gives the peer's address before any request is read.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { basename } from "node:path";
import type { ReviewId, Visibility } from "@plannotator/shared/review-api";
import { matchDoorRequest } from "./door-manifest.ts";

/** Where a door binds and the one address it accepts. */
export type DoorListen = { host: string; port: number; peer: string };

export type DoorOptions = DoorListen & {
  /** The Visibility of the Reviews this door serves. */
  visibility: Exclude<Visibility, "local">;
  /** Hostnames a request may name; others answer 404. */
  hostnames: readonly string[];
  /** A Review's Visibility now, or undefined when there is no such Review. */
  visibilityOf: (reviewId: ReviewId) => Visibility | undefined;
  /** The service's health answer. */
  health: () => Response;
  /** The service's answer for a Review page path (`/plannotator/session/<id>/...`). */
  page: (request: Request) => Promise<Response>;
  log: (line: string) => void;
  /** Requests per visitor per window; 300 unless a test names another. */
  limit?: number;
  windowMs?: number;
  /** How long a failed bind waits before the next attempt, e.g. while Tailscale comes up. */
  retryMs?: number;
};

export type Door = {
  visibility: Exclude<Visibility, "local">;
  /** The bound port, or null while the door is not bound. */
  port: () => number | null;
  /** Settles when the door first binds; never while the address stays unavailable. */
  bound: Promise<void>;
  /** Closes the door's open requests of [reviewId] unless [visibility] is still the door's. */
  revoke: (reviewId: ReviewId, visibility: Visibility) => void;
  stop: () => Promise<void>;
};

/** Requests one visitor may make per window before getting 429. */
export const DOOR_RATE_LIMIT = 300;
const DOOR_RATE_WINDOW_MS = 60_000;
const DOOR_BIND_RETRY_MS = 30_000;
/** The largest request body a door reads (the page's feedback and drafts). */
const DOOR_BODY_LIMIT = 4 * 1024 * 1024;
const FRAME_HEADERS = { "content-security-policy": "frame-ancestors 'none'", "x-frame-options": "DENY" } as const;
/** Response headers that describe the hop, not the answer; node writes its own. */
const HOP_HEADERS = new Set(["connection", "keep-alive", "transfer-encoding", "content-length"]);

/** Starts [options]' door; it binds at once, or keeps retrying while the address is not up. */
export function startDoor(options: DoorOptions): Door {
  const { visibility, peer, log } = options;
  const limit = options.limit ?? DOOR_RATE_LIMIT;
  const windowMs = options.windowMs ?? DOOR_RATE_WINDOW_MS;
  const logLine = (line: string) => log(`${visibility} door ${line}`);
  const hostnames = new Set(options.hostnames.map((name) => name.toLowerCase()));

  let windowStart = Date.now();
  const counts = new Map<string, number>();
  const noted = new Set<string>();
  /** Whether [visitor] may make another request now; the wait in seconds when not. */
  function allow(visitor: string): { ok: true } | { ok: false; retryAfter: number } {
    const now = Date.now();
    if (now - windowStart >= windowMs) {
      windowStart = now;
      counts.clear();
      noted.clear();
    }
    const count = (counts.get(visitor) ?? 0) + 1;
    counts.set(visitor, count);
    if (count <= limit) return { ok: true };
    if (!noted.has(`limited ${visitor}`)) {
      noted.add(`limited ${visitor}`);
      logLine(`rate-limited visitor=${encodeURIComponent(visitor)}`);
    }
    return { ok: false, retryAfter: Math.ceil((windowStart + windowMs - now) / 1000) };
  }

  function answersHost(req: IncomingMessage): boolean {
    if (!hostnames.has(hostnameOf(req.headers.host) ?? "")) return false;
    const forwarded = lastEntry(req.headers["x-forwarded-host"]);
    return !forwarded || hostnames.has(hostnameOf(forwarded) ?? "");
  }

  /** Open door requests per Review, so a Visibility change away closes them. */
  const open = new Map<ReviewId, Set<ServerResponse>>();
  function track(reviewId: ReviewId, res: ServerResponse): void {
    let responses = open.get(reviewId);
    if (!responses) {
      responses = new Set();
      open.set(reviewId, responses);
    }
    const tracked = responses;
    tracked.add(res);
    res.once("close", () => {
      tracked.delete(res);
      if (tracked.size === 0 && open.get(reviewId) === tracked) open.delete(reviewId);
    });
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const visitor = lastEntry(req.headers["x-forwarded-for"]) || plainAddress(req.socket.remoteAddress);
    const allowed = allow(visitor);
    if (!allowed.ok) {
      res.writeHead(429, { ...FRAME_HEADERS, "content-type": "text/plain", "retry-after": String(allowed.retryAfter) });
      res.end("Too Many Requests\n");
      return;
    }
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", "http://door");
    const match = answersHost(req) ? matchDoorRequest(method, url) : null;
    if (!match) return notFound(res);
    if (match.kind === "health") return send(res, options.health(), method);
    // Checked at request time: a Review made local a moment ago is not served.
    if (options.visibilityOf(match.reviewId) !== visibility) return notFound(res);

    track(match.reviewId, res);
    const body = method === "GET" || method === "HEAD" ? undefined : await readBody(req);
    // The body took time: a Review revoked meanwhile must not get the command.
    if (res.destroyed) return;
    if (options.visibilityOf(match.reviewId) !== visibility) return notFound(res);
    if (body === null) {
      res.writeHead(413, { ...FRAME_HEADERS, "content-type": "text/plain" });
      res.end("Payload Too Large\n");
      return;
    }
    const aborted = new AbortController();
    res.once("close", () => aborted.abort());
    const request = new Request(`http://door${url.pathname}${url.search}`, {
      method,
      headers: requestHeaders(req),
      body,
      signal: aborted.signal,
    });
    let answer = await options.page(request);
    // A request revoked while the service answered gets nothing.
    if (res.destroyed) {
      await answer.body?.cancel().catch(() => {});
      return;
    }
    if (method === "GET" && match.path === "/api/plan" && answer.ok) answer = await withoutLocalPaths(answer);
    await send(res, answer, method);
  }

  const sockets = new Set<Socket>();
  const server = createServer((req, res) => {
    handle(req, res).catch((cause: unknown) => {
      logLine(`request failed: ${cause instanceof Error ? cause.message : String(cause)}`);
      if (!res.headersSent) res.writeHead(500, FRAME_HEADERS);
      res.end();
    });
  });
  // No WebSocket is public: the listen socket and the page's agent terminal stay on this Mac.
  server.on("upgrade", (_req: IncomingMessage, socket: Socket) => {
    socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    socket.destroy();
  });
  server.on("connection", (socket: Socket) => {
    const address = plainAddress(socket.remoteAddress);
    if (address !== peer) {
      socket.destroy();
      if (!noted.has(`refused ${address}`)) {
        noted.add(`refused ${address}`);
        logLine(`refused connection from ${address}`);
      }
      return;
    }
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });

  let stopped = false;
  let retryTimer: NodeJS.Timeout | undefined;
  const bound = Promise.withResolvers<void>();
  function bind(): void {
    const onError = (cause: Error) => {
      server.off("listening", onListening);
      const retryMs = options.retryMs ?? DOOR_BIND_RETRY_MS;
      logLine(`could not bind ${options.host}:${options.port}: ${cause.message}; retrying in ${retryMs / 1000}s`);
      if (stopped) return;
      retryTimer = setTimeout(bind, retryMs);
      retryTimer.unref?.();
    };
    const onListening = () => {
      server.off("error", onError);
      logLine(`listening on ${options.host}:${doorPort()} for ${peer}`);
      bound.resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen({ host: options.host, port: options.port });
  }
  function doorPort(): number | null {
    const address = server.listening ? server.address() : null;
    return address && typeof address === "object" ? address.port : null;
  }
  bind();

  return {
    visibility,
    port: doorPort,
    bound: bound.promise,
    revoke(reviewId, next) {
      if (next === visibility) return;
      for (const res of open.get(reviewId) ?? []) res.destroy();
    },
    stop() {
      stopped = true;
      clearTimeout(retryTimer);
      for (const socket of sockets) socket.destroy();
      const { promise, resolve } = Promise.withResolvers<void>();
      if (server.listening) server.close(() => resolve());
      else resolve();
      return promise;
    },
  };
}

/** Writes [answer] to [res] with the anti-framing headers, streaming its body until either side closes. */
async function send(res: ServerResponse, answer: Response, method: string): Promise<void> {
  const headers: Record<string, string | string[]> = {};
  answer.headers.forEach((value, name) => {
    if (HOP_HEADERS.has(name)) return;
    const existing = headers[name];
    headers[name] = existing === undefined ? value : [...(Array.isArray(existing) ? existing : [existing]), value];
  });
  const csp = headers["content-security-policy"];
  headers["content-security-policy"] = [...(csp === undefined ? [] : Array.isArray(csp) ? csp : [csp]), FRAME_HEADERS["content-security-policy"]];
  headers["x-frame-options"] = FRAME_HEADERS["x-frame-options"];
  res.writeHead(answer.status, headers);
  if (method === "HEAD" || !answer.body) {
    await answer.body?.cancel().catch(() => {});
    res.end();
    return;
  }
  // Event streams must reach the visitor as they are written.
  res.flushHeaders();
  const reader = answer.body.getReader();
  const cancel = () => void reader.cancel().catch(() => {});
  res.once("close", cancel);
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done || res.destroyed) break;
      // Wait for a slow visitor to take what was written, so the end is sent only once
      // the body is nearly flushed, before a keep-alive timer can cut a buffered tail.
      if (!res.write(value)) {
        const drained = Promise.withResolvers<void>();
        res.once("drain", drained.resolve);
        res.once("close", drained.resolve);
        await drained.promise;
        res.off("drain", drained.resolve);
        res.off("close", drained.resolve);
      }
    }
  } catch {
    // The visitor left or the service closed the stream; nothing more to send.
  } finally {
    res.off("close", cancel);
    cancel();
    res.end();
  }
}

/** The fields of the page's `api/plan` answer (`annotate.ts`) the door rewrites. */
type PlanAnswer = Record<string, unknown> & {
  filePath?: string;
  sourceInfo?: string;
  serverConfig?: Record<string, unknown> & { gitUser?: unknown };
};

/**
 * The page's `api/plan` answer without what only this Mac should know: the document's
 * path becomes its file name; the project root, repo, git user and source path are
 * dropped; source save and the agent terminal are off (a visitor cannot use either).
 */
async function withoutLocalPaths(answer: Response): Promise<Response> {
  // The service's own page wrote this JSON; annotate.ts guarantees its shape.
  const data = (await answer.json()) as PlanAnswer;
  if (typeof data.filePath === "string") data.filePath = basename(data.filePath);
  if (typeof data.sourceInfo === "string") data.sourceInfo = basename(data.sourceInfo);
  delete data.projectRoot;
  delete data.repoInfo;
  data.sourceSave = { enabled: false, reason: "not-local-file" };
  data.agentTerminal = { enabled: false, reason: "not-annotate-mode" };
  if (data.serverConfig) delete data.serverConfig.gitUser;
  const headers = new Headers(answer.headers);
  headers.delete("content-length");
  return new Response(JSON.stringify(data), { status: answer.status, headers });
}

function notFound(res: ServerResponse): void {
  if (res.headersSent) return;
  res.writeHead(404, { ...FRAME_HEADERS, "content-type": "text/plain" });
  res.end("Not Found\n");
}

/** The request body, or null when it is larger than the door reads. */
async function readBody(req: IncomingMessage): Promise<Uint8Array<ArrayBuffer> | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  // node:http yields Buffers for a request without an encoding set.
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > DOOR_BODY_LIMIT) return null;
    chunks.push(chunk);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

function requestHeaders(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    for (const entry of Array.isArray(value) ? value : [value]) headers.append(name, entry);
  }
  return headers;
}

/** The last comma-separated entry of a header the proxy appends to, trimmed. */
function lastEntry(value: string | string[] | undefined): string {
  const joined = Array.isArray(value) ? value.join(",") : (value ?? "");
  return joined.split(",").pop()?.trim() ?? "";
}

function plainAddress(address: string | undefined): string {
  return (address ?? "").replace(/^::ffff:/, "");
}

/** The lowercase hostname of a Host header value, or null when it is not a bare `host[:port]`. */
function hostnameOf(authority: string | undefined): string | null {
  if (!authority || /[@/?#\\\s]/.test(authority)) return null;
  return URL.canParse(`http://${authority}`) ? new URL(`http://${authority}`).hostname.toLowerCase() : null;
}
