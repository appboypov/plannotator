/**
 * `plannotator annotate <file>` through the review service (fork-owned). The command
 * opens (or reopens) the file's Review in the running `plannotator serve`, prints its
 * link, waits on the listen socket for the Round's result and hands it back as the
 * same `AnnotateOutcome` upstream's one-shot server settles, so the output, the strict
 * gate's exit codes and `--result-file` stay upstream's. See docs/review-api.md.
 *
 * Each call listens under its own session id, so two calls on two files run at once.
 * One call is one Round, as one upstream annotate server was one decision:
 * - Approve finishes the Round: `approved`, with the Approve's notes as `feedback`.
 * - Close finishes it with a `dismissed` notice: `dismissed`.
 * - Send feedback stores Remarks and leaves the Round open; the command takes them,
 *   cancels the Round (the page closes, as upstream's page did after feedback) and
 *   prints them as `annotated`. The next call opens the next Round on the same link,
 *   with the document as it is then.
 */
import { randomBytes } from "node:crypto";
import {
  API_VERSION,
  LISTEN_PATH,
  REVIEWS_PATH,
  VERSION_PATH,
  cancelPath,
  type ListenServerMessage,
  type Notice,
  type OpenReviewResponse,
  type Remark,
} from "@plannotator/shared/review-api";
import { handleAnnotateServerReady, isRemoteSession } from "@plannotator/server/annotate";
import { resolveServicePort } from "@plannotator/server/review-service";
import { completeAnnotateCommand } from "./annotate-command";
import type { AnnotateOutcome } from "./strict-annotate-result";

/** What a call ends with: the reviewer's outcome, or why the gate could not run. */
export type ServiceAnnotateResult = { ok: true; outcome: AnnotateOutcome } | { ok: false; error: string };

export interface ServiceAnnotateOptions {
  /** The document's absolute path. */
  file: string;
  /** The service's port on 127.0.0.1 (`PLANNOTATOR_SERVICE_PORT`, else 4397). */
  port: number;
  /** Called once the Review is open, before the command waits: print and open its link. */
  onOpened: (review: OpenReviewResponse) => Promise<void> | void;
  /** The listen session; a fresh one per call by default. */
  sessionId?: string;
  /** How often to reconnect a listen socket the service dropped, and how long to wait between tries. */
  reconnect?: { attempts: number; delayMs: number };
  log?: (line: string) => void;
}

const DEFAULT_RECONNECT = { attempts: 30, delayMs: 1_000 };
const REQUEST_TIMEOUT_MS = 10_000;
const BARRIER_TIMEOUT_MS = 2_000;

/** The error when nothing answers on the service's port. */
export function serviceNotRunningMessage(origin: string): string {
  return [
    `No Plannotator review service answers on ${origin}.`,
    "Start it with `plannotator serve` (127.0.0.1:4397, or the port in PLANNOTATOR_SERVICE_PORT),",
    "then run this command again.",
  ].join("\n");
}

/** A listen session id for one annotate call. */
export function annotateSessionId(): string {
  return `plannotator-annotate-${process.pid}-${randomBytes(6).toString("hex")}`;
}

/**
 * Whether `annotate` takes the service for this target: a local file, as the service
 * keeps one Review per file. URLs, folders, live apps, `--tailscale` and `--markdown`
 * keep upstream's one-shot server: the service has no page for them.
 */
export function annotatesThroughService(target: {
  isUrl: boolean;
  folderPath?: string;
  liveApp: boolean;
  tailscale: boolean;
  renderMarkdown: boolean;
}): boolean {
  return !target.isUrl && !target.folderPath && !target.liveApp && !target.tailscale && !target.renderMarkdown;
}

/**
 * `plannotator annotate <file>` through the service, end to end: open, print and open
 * the link, wait, then print the outcome and exit as upstream's annotate does. [fail]
 * is the annotate startup failure (exit 2 under a strict flag, else 1); a service that
 * does not answer is one, since no reviewer outcome exists. It never returns: the
 * process exits with the outcome's code.
 */
export async function runServiceAnnotateCommand(options: {
  file: string;
  requireApproval: boolean;
  resultFile?: string;
  emitLegacyOutcome: (result: AnnotateOutcome) => void;
  fail: (message: string) => never;
}): Promise<never> {
  const port = resolveServicePort();
  if (!port.ok) options.fail(port.error);
  const result = await annotateThroughService({
    file: options.file,
    port: port.value,
    onOpened: async (review) => {
      process.stderr.write(`\n  Plannotator review, round ${review.round}:\n  ${review.link}\n\n`);
      await handleAnnotateServerReady(review.link, isRemoteSession(), port.value);
    },
    log: (line) => console.error(`[plannotator] ${line}`),
  });
  if (!result.ok) options.fail(result.error);
  await completeAnnotateCommand({
    waitForDecision: async () => result.outcome,
    settleAfterDecision: async () => {},
    stopServer: () => {},
    requireApproval: options.requireApproval,
    resultFile: options.resultFile,
    emitLegacyOutcome: options.emitLegacyOutcome,
  });
  // completeAnnotateCommand has exited with the outcome's code; this is never reached.
  process.exit(0);
}

/** Opens [options.file]'s Review in the service and waits for the Round's result. */
export async function annotateThroughService(options: ServiceAnnotateOptions): Promise<ServiceAnnotateResult> {
  const origin = `http://127.0.0.1:${options.port}`;

  let versionAnswer: Response;
  try {
    versionAnswer = await fetch(`${origin}${VERSION_PATH}`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch {
    return { ok: false, error: serviceNotRunningMessage(origin) };
  }
  const version = versionAnswer.ok ? await versionAnswer.json().catch(() => undefined) : undefined;
  const major = version !== null && typeof version === "object" ? Reflect.get(version, "major") : undefined;
  if (typeof major !== "number") {
    return { ok: false, error: `${origin} is not a Plannotator review service (GET ${VERSION_PATH}: HTTP ${versionAnswer.status}).` };
  }
  if (major !== API_VERSION.major) {
    return {
      ok: false,
      error: `The review service on ${origin} speaks review API ${major}; this plannotator speaks ${API_VERSION.major}. Update one of them.`,
    };
  }

  // `reopen` starts the next Round of a Review the reviewer approved; an open Review
  // keeps its Round, a cancelled one reopens anyway.
  let opened: OpenReviewResponse;
  try {
    const answer = await fetch(`${origin}${REVIEWS_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file: options.file, reopen: true }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body: unknown = await answer.json().catch(() => undefined);
    if (!answer.ok) {
      const reason = body !== null && typeof body === "object" ? Reflect.get(body, "error") : undefined;
      return {
        ok: false,
        error: `The review service could not open ${options.file}: ${typeof reason === "string" ? reason : `HTTP ${answer.status}`}`,
      };
    }
    opened = body as OpenReviewResponse;
  } catch (cause) {
    return { ok: false, error: `The review service on ${origin} did not open ${options.file}: ${describe(cause)}` };
  }

  await options.onOpened(opened);
  return waitForRound(origin, opened, options);
}

/** Listens for [review]'s current Round until it ends, acknowledging the notice it takes. */
function waitForRound(
  origin: string,
  review: OpenReviewResponse,
  options: ServiceAnnotateOptions,
): Promise<ServiceAnnotateResult> {
  const sessionId = options.sessionId ?? annotateSessionId();
  const reconnect = options.reconnect ?? DEFAULT_RECONNECT;
  const log = options.log ?? (() => {});
  const listenUrl = new URL(LISTEN_PATH, origin);
  listenUrl.protocol = "ws:";
  listenUrl.searchParams.set("session", sessionId);

  const remarks = new Map<string, Remark>();
  let cancelling = false;
  let settled = false;
  let tries = 0;
  let socket: WebSocket | undefined;
  let resolve: (result: ServiceAnnotateResult) => void = () => {};
  const promise = new Promise<ServiceAnnotateResult>((settled) => {
    resolve = settled;
  });

  const settle = (result: ServiceAnnotateResult) => {
    if (settled) return;
    settled = true;
    const ws = socket;
    if (ws?.readyState !== WebSocket.OPEN) {
      ws?.close();
      resolve(result);
      return;
    }
    // The command exits right after this resolves, and an ack gets no answer. The
    // service takes a socket's frames in order, so once it confirms this empty
    // subscription it has taken the ack sent before it.
    const done = () => {
      clearTimeout(timer);
      ws.close(1000, "annotate done");
      resolve(result);
    };
    const timer = setTimeout(done, BARRIER_TIMEOUT_MS);
    ws.onmessage = (event) => {
      try {
        if (JSON.parse(String(event.data)).type === "subscribed") done();
      } catch {
        // Not JSON: not the confirmation.
      }
    };
    ws.onclose = done;
    ws.send(JSON.stringify({ type: "subscribe", reviews: [] }));
  };

  // The command takes the feedback: it ends the Round, and the Cancel notice that
  // follows on this socket marks the end of what the reviewer sent.
  const cancelRound = async () => {
    cancelling = true;
    try {
      const answer = await fetch(`${origin}${cancelPath(review.review_id)}`, {
        method: "POST",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!answer.ok) settle({ ok: false, error: `The review service did not end the Round: HTTP ${answer.status}` });
    } catch (cause) {
      // The service went away; the socket reconnects and tries again.
      cancelling = false;
      log(`could not end round ${review.round} of ${review.review_id}: ${describe(cause)}`);
    }
  };

  const take = (ws: WebSocket, notice: Notice) => {
    ws.send(JSON.stringify({ type: "ack", id: notice.id }));
    const sent = [...remarks.values()];
    if (notice.type === "cancel") {
      if (sent.length > 0) settle({ ok: true, outcome: { feedback: formatRemarksFeedback(sent) } });
      else settle({ ok: false, error: `Round ${review.round} of ${review.link} was cancelled by another agent.` });
      return;
    }
    if (notice.dismissed) {
      settle({ ok: true, outcome: sent.length > 0 ? { feedback: formatRemarksFeedback(sent) } : { feedback: "", exit: true } });
      return;
    }
    // Feedback sent just before an Approve still reaches the agent, ahead of the notes.
    const feedback = [sent.length > 0 ? formatRemarksFeedback(sent) : "", notice.notes].filter(Boolean).join("\n\n");
    settle({ ok: true, outcome: { approved: true, feedback } });
  };

  const receive = (ws: WebSocket, frame: string) => {
    let message: ListenServerMessage;
    try {
      message = JSON.parse(frame) as ListenServerMessage;
    } catch {
      return;
    }
    if (message.type === "error") {
      log(`review service: ${message.error}`);
      return;
    }
    // Only the Round this call opened: earlier Rounds' open Remarks and pending notices replay too.
    if (!("round" in message) || message.review_id !== review.review_id || message.round !== review.round) return;
    if (message.type === "feedback_item") {
      const { type: _type, ...remark } = message;
      if (!remarks.has(remark.id)) remarks.set(remark.id, remark);
      if (!cancelling) void cancelRound();
    } else if (message.type === "finish" || message.type === "cancel") {
      take(ws, message);
    }
  };

  const connect = () => {
    const ws = new WebSocket(listenUrl.href);
    socket = ws;
    ws.onopen = () => {
      tries = 0;
      ws.send(JSON.stringify({ type: "subscribe", reviews: [review.review_id] }));
      if (remarks.size > 0 && !cancelling) void cancelRound();
    };
    ws.onmessage = (event) => receive(ws, typeof event.data === "string" ? event.data : String(event.data));
    ws.onclose = () => {
      if (settled || socket !== ws) return;
      if (tries >= reconnect.attempts) {
        settle({ ok: false, error: `Lost the review service on ${origin} while waiting for ${review.link}.` });
        return;
      }
      tries += 1;
      setTimeout(connect, reconnect.delayMs);
    };
  };

  connect();
  return promise;
}

/**
 * Remarks as the agent-facing feedback upstream's annotate page exports for a file
 * (`exportAnnotations` in packages/ui/utils/parser.ts): the same headings and entry
 * shapes, without what a Remark does not carry (line numbers, images).
 */
export function formatRemarksFeedback(remarks: readonly Remark[]): string {
  const count = remarks.length;
  let output = `# File Feedback\n\nI've reviewed this file and have ${count} piece${count > 1 ? "s" : ""} of feedback:\n\n`;
  remarks.forEach((remark, index) => {
    output += `## ${index + 1}. `;
    if (remark.anchor.tag === "deletion") {
      output += `Remove this\n\`\`\`\n${remark.anchor.text}\n\`\`\`\n> I don't want this in the file.\n`;
      if (remark.text) output += `> ${remark.text}\n`;
    } else if (remark.anchor.tag === "global_comment" || !remark.anchor.text) {
      output += `General feedback about the file\n> ${remark.text}\n`;
    } else {
      output += `Feedback on: "${remark.anchor.text}"\n> ${remark.text}\n`;
    }
    output += "\n";
  });
  return `${output}---\n`;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
