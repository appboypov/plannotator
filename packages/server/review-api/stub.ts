/**
 * Review API v1 stub (fork-owned): answers every route of docs/review-api.md with
 * contract-valid placeholder data, so the plugin and the CLI can be built against the
 * contract before the service exists. Reviews live in memory; no page remark ever
 * arrives, so a Reply may name no Remark and an ack names no notice. The real service
 * (`plannotator serve`) replaces this file.
 *
 *   bun packages/server/review-api/stub.ts [port]    # default 4397 on 127.0.0.1
 */
import { createHash, randomBytes } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import {
  API_VERSION,
  DEFAULT_TEMPORARY_ORIGIN,
  ERRORS,
  HEALTH_PATH,
  LISTEN_PATH,
  PUBLIC_ORIGIN,
  REVIEWS_PATH,
  SERVICE_PORT,
  SESSION_PATH_PREFIX,
  VERSION_PATH,
  parseListReviewsQuery,
  parseListenClientMessage,
  parseListenSession,
  parseOpenReviewRequest,
  parseReplyRequest,
  parseVisibilityRequest,
  reviewLink,
  type CancelReviewResponse,
  type ErrorResponse,
  type HealthResponse,
  type LinkOrigins,
  type ListenServerMessage,
  type ListReviewsResponse,
  type OpenReviewResponse,
  type ReplyResponse,
  type Review,
  type ReviewId,
  type UnknownRemarksResponse,
  type VisibilityResponse,
} from "@plannotator/shared/review-api";
import type { Server, ServerWebSocket } from "bun";

export type ReviewApiStubOptions = {
  port?: number;
  hostname?: string;
  temporaryOrigin?: string;
};

type Listener = { session: string };

type StubReview = Pick<Review, "review_id" | "file" | "visibility" | "round" | "state" | "round_opened_at">;

const LISTEN_MAX_PAYLOAD = 64 * 1024;
const REVIEW_ROUTE = new RegExp(`^${REVIEWS_PATH}/([^/]+)/(replies|cancel|visibility)$`);

/** Starts the stub; `port: 0` picks a free port (read it from `server.port`). */
export function startReviewApiStub(options: ReviewApiStubOptions = {}): Server<Listener> {
  const hostname = options.hostname ?? "127.0.0.1";
  const reviews = new Map<ReviewId, StubReview>();
  const sockets = new Map<string, ServerWebSocket<Listener>>();
  let origins: LinkOrigins;

  const summary = (review: StubReview): Review => ({
    ...review,
    link: reviewLink(review.review_id, review.visibility, origins),
    open_item_count: 0,
    last_page_open: null,
    listeners: [],
  });

  async function route(request: Request, server: Server<Listener>): Promise<Response | undefined> {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    if (method === "GET" && pathname === VERSION_PATH) return Response.json(API_VERSION);
    if (method === "GET" && pathname === HEALTH_PATH) {
      return Response.json({ ok: true, app: "plannotator", version: "review-api-stub", api: API_VERSION } satisfies HealthResponse);
    }
    if (method === "GET" && pathname === LISTEN_PATH) {
      const session = parseListenSession(url.searchParams.get("session"));
      if (!session.ok) return new Response(`${session.error}\n`, { status: 400 });
      return server.upgrade(request, { data: { session: session.value } })
        ? undefined
        : new Response("websocket upgrade required\n", { status: 400 });
    }
    if (pathname === REVIEWS_PATH && method === "POST") return open(await readJson(request));
    if (pathname === REVIEWS_PATH && method === "GET") return list(url.searchParams.get("file"));

    const match = method === "POST" ? REVIEW_ROUTE.exec(pathname) : null;
    if (match) {
      const review = reviews.get(decodeURIComponent(match[1]));
      if (!review) return error(404, ERRORS.reviewNotFound);
      if (match[2] === "cancel") return cancel(review);
      const body = await readJson(request);
      return match[2] === "replies" ? reply(review, body) : setVisibility(review, body);
    }

    if (method === "GET" && pathname.startsWith(SESSION_PATH_PREFIX)) {
      const review = reviews.get(pathname.slice(SESSION_PATH_PREFIX.length).split("/")[0]);
      if (review) {
        return new Response(`<!doctype html><title>Plannotator stub</title><p>Review ${review.review_id}, round ${review.round}: ${review.file}</p>\n`, {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
    }
    return error(404, "not found");
  }

  async function open(body: unknown | typeof MALFORMED): Promise<Response> {
    if (body === MALFORMED) return error(400, "malformed JSON");
    const parsed = parseOpenReviewRequest(body);
    if (!parsed.ok) return error(400, parsed.error);
    const { file: requested, visibility } = parsed.value;
    const found = await stat(requested).catch(() => undefined);
    if (!found?.isFile()) return error(404, `file not found: ${requested}`);
    const file = await realpath(requested);
    const reviewId = createHash("sha256").update(file).digest("hex").slice(0, 16);
    const existing = reviews.get(reviewId);
    const review: StubReview = existing ?? {
      review_id: reviewId,
      file,
      visibility: visibility ?? "local",
      round: 1,
      state: "open",
      round_opened_at: new Date().toISOString(),
    };
    if (existing && existing.state !== "open") {
      review.round += 1;
      review.state = "open";
      review.round_opened_at = new Date().toISOString();
    }
    if (existing && visibility) review.visibility = visibility;
    reviews.set(reviewId, review);
    return Response.json({
      review_id: reviewId,
      link: reviewLink(reviewId, review.visibility, origins),
      status: "opened",
      round: review.round,
      visibility: review.visibility,
    } satisfies OpenReviewResponse);
  }

  async function list(fileQuery: string | null): Promise<Response> {
    const parsed = parseListReviewsQuery(fileQuery);
    if (!parsed.ok) return error(400, parsed.error);
    const { file } = parsed.value;
    const canonical = file === undefined ? undefined : await realpath(file).catch(() => file);
    const entries = [...reviews.values()]
      .filter((review) => canonical === undefined || review.file === canonical)
      .sort((a, b) => a.file.localeCompare(b.file))
      .map((review) => (canonical === undefined ? summary(review) : { ...summary(review), open_items: [] }));
    return Response.json({ reviews: entries } satisfies ListReviewsResponse);
  }

  function reply(review: StubReview, body: unknown | typeof MALFORMED): Response {
    if (body === MALFORMED) return error(400, "malformed JSON");
    const parsed = parseReplyRequest(body);
    if (!parsed.ok) return error(400, parsed.error);
    const { text, answers } = parsed.value;
    if (answers.length > 0) {
      return Response.json({ error: ERRORS.unknownRemarks, unknown: answers } satisfies UnknownRemarksResponse, {
        status: 400,
      });
    }
    return Response.json({
      status: "sent",
      answered: [],
      reply: { id: `rp_${randomBytes(12).toString("hex")}`, review_id: review.review_id, text, answers: [], at: new Date().toISOString() },
    } satisfies ReplyResponse);
  }

  function cancel(review: StubReview): Response {
    if (review.state === "open") review.state = "cancelled";
    const state = review.state === "finished" ? "finished" : "cancelled";
    return Response.json({ review_id: review.review_id, state, round: review.round } satisfies CancelReviewResponse);
  }

  function setVisibility(review: StubReview, body: unknown | typeof MALFORMED): Response {
    if (body === MALFORMED) return error(400, "malformed JSON");
    const parsed = parseVisibilityRequest(body);
    if (!parsed.ok) return error(400, parsed.error);
    review.visibility = parsed.value.visibility;
    return Response.json({
      review_id: review.review_id,
      visibility: review.visibility,
      link: reviewLink(review.review_id, review.visibility, origins),
    } satisfies VisibilityResponse);
  }

  const server = Bun.serve<Listener>({
    hostname,
    port: options.port ?? SERVICE_PORT,
    fetch: route,
    websocket: {
      maxPayloadLength: LISTEN_MAX_PAYLOAD,
      open(socket) {
        sockets.get(socket.data.session)?.close(1000, "replaced by a new listener");
        sockets.set(socket.data.session, socket);
      },
      message(socket, frame) {
        const parsed = parseListenClientMessage(typeof frame === "string" ? frame : frame.toString("utf8"));
        const answer: ListenServerMessage = !parsed.ok
          ? { type: "error", error: parsed.error }
          : parsed.value.type === "subscribe"
            ? { type: "subscribed", reviews: parsed.value.reviews }
            : { type: "error", error: `unknown notice ${parsed.value.id}` };
        socket.send(JSON.stringify(answer));
      },
      close(socket) {
        if (sockets.get(socket.data.session) === socket) sockets.delete(socket.data.session);
      },
    },
  });
  origins = {
    local: `http://${hostname}:${server.port}`,
    public: PUBLIC_ORIGIN,
    temporary: options.temporaryOrigin ?? DEFAULT_TEMPORARY_ORIGIN,
  };
  return server;
}

const MALFORMED = Symbol("malformed JSON");

async function readJson(request: Request): Promise<unknown | typeof MALFORMED> {
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return MALFORMED;
  }
}

function error(status: number, message: string): Response {
  return Response.json({ error: message } satisfies ErrorResponse, { status });
}

if (import.meta.main) {
  const port = process.argv[2] ? Number(process.argv[2]) : SERVICE_PORT;
  const server = startReviewApiStub({ port });
  console.error(`review API v1 stub listening on http://${server.hostname}:${server.port}`);
}
