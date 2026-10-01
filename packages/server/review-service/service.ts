/**
 * The fork's review service (`plannotator serve`): one long-lived server on
 * 127.0.0.1 that serves many documents, each as a Review with a lasting id, link and
 * folder. It answers every review API v1 route (version, open, list, Replies,
 * Cancel, visibility, the listen socket), health, and every Review's page under
 * `/plannotator/session/<id>/`, which it forwards to that Review's own upstream
 * annotate server (see `pages.ts`) except the page's Round-checked commands: Send
 * feedback becomes Remarks, Approve and Close finish the Round (ADR 0006; see
 * `records.ts`, `listen.ts`), the page's Round stream (`page-rounds.ts`) and the
 * page's Remarks with their Replies (`api/review-replies`).
 * Contract: docs/review-api.md.
 */
import { realpath, stat } from "node:fs/promises";
import {
  API_VERSION,
  DEFAULT_TEMPORARY_ORIGIN,
  ERRORS,
  HEALTH_PATH,
  LISTEN_PATH,
  PUBLIC_ORIGIN,
  PAGE_REPLIES_PATH,
  REVIEWS_PATH,
  SESSION_PATH_PREFIX,
  VERSION_PATH,
  isLocalRequest,
  parseListReviewsQuery,
  parseListenSession,
  parsePageRound,
  parseOpenReviewRequest,
  parseReplyRequest,
  parseVisibilityRequest,
  reviewLink,
  reviewPagePath,
  type ErrorResponse,
  type HealthResponse,
  type LinkOrigins,
  type ListReviewsResponse,
  type CancelReviewResponse,
  type EndedRoundResponse,
  type OpenReviewResponse,
  type ReplyResponse,
  type Review,
  type Round,
  type RoundRefusal,
  type UnknownRemarksResponse,
  type VisibilityResponse,
} from "@plannotator/shared/review-api";
import type { Server } from "bun";
import { PAGE_ROUND_META, PAGE_ROUND_PATH } from "@plannotator/shared/review-api/page-round";
import { ReviewListeners, listenData, type ListenData } from "./listen.ts";
import { PageRounds } from "./page-rounds.ts";
import { ReviewPages, type StartReviewPage } from "./pages.ts";
import { ReviewRecords, openRemark, recordId, remarksFromFeedback, type StoredNotice } from "./records.ts";
import { ReviewStore, reviewIdForFile, type StoredReview } from "./store.ts";

export type ReviewServiceOptions = {
  /** Port on [hostname]; `0` picks a free one (read it from `url`). */
  port: number;
  /** Folder holding one folder per Review. */
  reviewsDir: string;
  /** The build version health reports, such as `0.27.23`. */
  version: string;
  /** Starts a Review's page: the upstream annotate server for its document. */
  startPage: StartReviewPage;
  hostname?: string;
  /** The ngrok origin of `temporary` links until story 1.11's setting names another. */
  temporaryOrigin?: string;
  log?: (line: string) => void;
  /** How often listeners are pinged; the contract's 30 seconds unless a test names another. */
  heartbeatMs?: number;
};

export type ReviewService = {
  /** The service's own origin, such as `http://127.0.0.1:4397`. */
  url: string;
  port: number;
  /** Stops every page and the server. Review state stays on disk. */
  stop: () => Promise<void>;
};

const REVIEW_ROUTE = new RegExp(`^${REVIEWS_PATH}/([^/]+)/(replies|visibility|cancel)$`);
const DRAFT_PATH = "/api/draft";
const ROUND_STREAM_PATH = `/${PAGE_ROUND_PATH}`;
const REPLIES_PAGE_PATH = `/${PAGE_REPLIES_PATH}`;

/** The page's Round-checked commands the service answers itself (ADR 0006). */
type PageCommand = "feedback" | "approve" | "exit";
const PAGE_COMMANDS: Record<string, PageCommand> = {
  "/api/feedback": "feedback",
  "/api/approve": "approve",
  "/api/exit": "exit",
};
const MALFORMED = Symbol("malformed JSON");

/** Loads the Reviews under `reviewsDir` and starts serving them. */
export async function startReviewService(options: ReviewServiceOptions): Promise<ReviewService> {
  const hostname = options.hostname ?? "127.0.0.1";
  const log = options.log ?? ((line: string) => console.error(`[plannotator] ${line}`));
  const store = await ReviewStore.load(options.reviewsDir, log);
  const records = await ReviewRecords.load(
    store.all().map((review) => review.review_id),
    (reviewId) => store.folder(reviewId),
    log,
  );
  const listeners = new ReviewListeners(records, log, options.heartbeatMs);
  const pages = new ReviewPages(options.startPage);
  const pageRounds = new PageRounds();
  let origins: LinkOrigins;

  const summary = (review: StoredReview): Review => ({
    ...review,
    link: reviewLink(review.review_id, review.visibility, origins),
    open_item_count: records.open(review.review_id).length,
    listeners: listeners.subscribers(review.review_id),
  });

  async function route(request: Request, server: Server<ListenData>): Promise<Response | undefined> {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;
    const headers = request.headers;
    const fromThisMac = isLocalRequest(
      { host: headers.get("host"), origin: headers.get("origin"), referer: headers.get("referer") },
      server.port ?? 0,
      method === "POST" || pathname === LISTEN_PATH,
    );
    if (!fromThisMac) return error(403, ERRORS.forbidden);

    if (method === "GET" && pathname === LISTEN_PATH) {
      const session = parseListenSession(url.searchParams.get("session"));
      if (!session.ok) return new Response(`${session.error}\n`, { status: 400 });
      return server.upgrade(request, { data: listenData(session.value) })
        ? undefined
        : new Response("websocket upgrade required\n", { status: 400 });
    }

    if (method === "GET" && pathname === VERSION_PATH) return Response.json(API_VERSION);
    if (method === "GET" && pathname === HEALTH_PATH) {
      return Response.json({ ok: true, app: "plannotator", version: options.version, api: API_VERSION } satisfies HealthResponse);
    }
    if (pathname === REVIEWS_PATH && method === "POST") return open(await readJson(request));
    if (pathname === REVIEWS_PATH && method === "GET") return list(url.searchParams.get("file"));

    const reviewMatch = method === "POST" ? REVIEW_ROUTE.exec(pathname) : null;
    if (reviewMatch) {
      const review = store.get(decodeURIComponent(reviewMatch[1]));
      if (!review) return error(404, ERRORS.reviewNotFound);
      if (reviewMatch[2] === "cancel") return cancel(review);
      const body = await readJson(request);
      return reviewMatch[2] === "replies" ? reply(review, body) : setVisibility(review, body);
    }

    if (pathname.startsWith(SESSION_PATH_PREFIX)) {
      const [reviewId, ...rest] = pathname.slice(SESSION_PATH_PREFIX.length).split("/");
      const review = store.get(reviewId);
      if (!review) return error(404, ERRORS.reviewNotFound);
      // The page calls its API relative to its own path, which needs the trailing slash.
      if (rest.length === 0) return Response.redirect(`${reviewPagePath(reviewId)}${url.search}`, 308);
      const path = `/${rest.join("/")}`;
      const command = method === "POST" ? PAGE_COMMANDS[path] : undefined;
      if (command) return pageCommand(command, review, request, url);
      if (method === "GET" && path === ROUND_STREAM_PATH) return pageRounds.stream(roundOf(review));
      if (method === "GET" && path === REPLIES_PAGE_PATH) return Response.json(records.page(review.review_id));
      return page(request, review, path, url.search);
    }
    return error(404, "not found");
  }

  async function open(body: unknown): Promise<Response> {
    if (body === MALFORMED) return error(400, "malformed JSON");
    const parsed = parseOpenReviewRequest(body);
    if (!parsed.ok) return error(400, parsed.error);
    const { file: requested, visibility, reopen } = parsed.value;
    const found = await stat(requested).catch(() => undefined);
    if (!found?.isFile()) return error(404, `file not found: ${requested}`);
    const file = await realpath(requested);
    const reviewId = reviewIdForFile(file);
    const existing = store.get(reviewId);
    // The reviewer's Approve stands until the agent asks to reopen it; nothing is written.
    if (existing?.state === "finished" && !reopen) {
      return Response.json({
        review_id: reviewId,
        link: reviewLink(reviewId, existing.visibility, origins),
        status: "user-ended",
        round: existing.round,
        visibility: existing.visibility,
      } satisfies OpenReviewResponse);
    }
    const now = new Date().toISOString();
    const nextRound = existing !== undefined && existing.state !== "open";
    const review: StoredReview = existing
      ? {
          ...existing,
          visibility: visibility ?? existing.visibility,
          ...(nextRound ? { round: existing.round + 1, state: "open", round_opened_at: now } : {}),
        }
      : {
          review_id: reviewId,
          file,
          visibility: visibility ?? "local",
          round: 1,
          state: "open",
          round_opened_at: now,
          last_page_open: null,
        };
    if (!existing || nextRound || review.visibility !== existing.visibility) await store.save(review);
    if (!existing) log(`opened Review ${reviewId} for ${file}`);
    if (nextRound) {
      log(`opened round ${review.round} of Review ${reviewId}`);
      // The new Round's page shows the document as it is now.
      await pages.stop(reviewId);
      pageRounds.publish(roundOf(review));
    }
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
    const reviews = store
      .all()
      .filter((review) => canonical === undefined || review.file === canonical)
      .sort((a, b) => a.file.localeCompare(b.file))
      .map((review) =>
        canonical === undefined
          ? summary(review)
          : { ...summary(review), open_items: records.open(review.review_id).map(openRemark) },
      );
    return Response.json({ reviews } satisfies ListReviewsResponse);
  }

  async function setVisibility(review: StoredReview, body: unknown): Promise<Response> {
    if (body === MALFORMED) return error(400, "malformed JSON");
    const parsed = parseVisibilityRequest(body);
    if (!parsed.ok) return error(400, parsed.error);
    // Read again after the body arrived: a Cancel or reopen meanwhile must stand.
    const current = store.get(review.review_id) ?? review;
    const updated = { ...current, visibility: parsed.value.visibility };
    if (updated.visibility !== current.visibility) await store.save(updated);
    return Response.json({
      review_id: updated.review_id,
      visibility: updated.visibility,
      link: reviewLink(updated.review_id, updated.visibility, origins),
    } satisfies VisibilityResponse);
  }

  /**
   * An agent's Reply, stored in the Review's folder and shown on its page beside the
   * Remarks it names, from any Round, open or ended. Each named Remark is answered and
   * no longer replayed. A Reply naming a Remark the Review does not have writes nothing.
   */
  async function reply(review: StoredReview, body: unknown): Promise<Response> {
    if (body === MALFORMED) return error(400, "malformed JSON");
    const parsed = parseReplyRequest(body);
    if (!parsed.ok) return error(400, parsed.error);
    const unknown = records.unknownRemarks(review.review_id, parsed.value.answers);
    if (unknown.length > 0) {
      return Response.json({ error: ERRORS.unknownRemarks, unknown } satisfies UnknownRemarksResponse, { status: 400 });
    }
    const stored = {
      id: recordId("rp"),
      review_id: review.review_id,
      text: parsed.value.text,
      answers: parsed.value.answers,
      at: new Date().toISOString(),
    };
    await records.addReply(stored);
    log(`stored Reply ${stored.id} for Review ${review.review_id} answering ${stored.answers.length} Remark(s)`);
    return Response.json({ status: "sent", answered: stored.answers, reply: stored } satisfies ReplyResponse);
  }

  /**
   * An agent's Cancel: ends the current Round with a Cancel notice, which listeners
   * receive and the page's Round stream closes the page on. An ended Review writes
   * nothing and reports how it ended.
   */
  async function cancel(review: StoredReview): Promise<Response> {
    const ended = review.state === "open" ? await endRound(review, { type: "cancel" }) : review;
    return Response.json({
      review_id: ended.review_id,
      state: ended.state === "finished" ? "finished" : "cancelled",
      round: ended.round,
    } satisfies CancelReviewResponse);
  }

  /**
   * A Round-checked page command (ADR 0006). The upstream page server never sees it, so
   * its one-shot decision stays open:
   * - Send feedback: each annotation becomes one Remark of the current Round, stored
   *   before the answer and sent to the Review's listeners; the reviewer can send again.
   * - Approve: finishes the Round with a Finish notice whose `notes` are the page's
   *   `feedback` text (`""` without notes).
   * - Close (`api/exit`): finishes the Round like an Approve without notes, as upstream's
   *   gate lets a dismissed review pass. Its `round` and draft generation are queries.
   * A `round` that is not the open Round answers 409 and writes nothing. The service first
   * clears the sent draft on the page server, as upstream's own routes do; when that
   * fails nothing is stored, so a reload cannot bring back what was already sent.
   */
  async function pageCommand(command: PageCommand, review: StoredReview, request: Request, url: URL): Promise<Response> {
    const body = command === "exit" ? {} : await readJson(request);
    if (body === MALFORMED) return error(400, "malformed JSON");
    const roundQuery = url.searchParams.get("round");
    const round = parsePageRound(command === "exit" ? (roundQuery === null ? undefined : Number(roundQuery)) : field(body, "round"));
    if (!round.ok) return error(400, round.error);
    const refused = roundRefusal(review, round.value);
    if (refused) return Response.json(refused satisfies RoundRefusal, { status: 409 });

    const generation = command === "exit" ? url.searchParams.get("generation") : field(body, "draftGeneration");
    const search = typeof generation === "number" || typeof generation === "string" ? `?generation=${generation}` : "";
    const cleared = await page(new Request(request.url, { method: "DELETE" }), review, DRAFT_PATH, search);
    if (!cleared.ok) {
      log(`could not clear the sent draft of Review ${review.review_id}: HTTP ${cleared.status}`);
      return error(502, `${command} not stored: the page could not clear its draft`);
    }
    // Another command may have ended the Round while the draft was cleared.
    const current = store.get(review.review_id) ?? review;
    const refusedNow = roundRefusal(current, round.value);
    if (refusedNow) return Response.json(refusedNow satisfies RoundRefusal, { status: 409 });

    if (command === "feedback") {
      const added = remarksFromFeedback(body, current, new Date().toISOString());
      if (added.length > 0) {
        await records.addRemarks(current.review_id, added);
        log(`stored ${added.length} Remark(s) for Review ${current.review_id} round ${current.round}`);
        await listeners.remarksStored(current.review_id, added);
      }
    } else {
      const notes = field(body, "feedback");
      await endRound(current, { type: "finish", notes: typeof notes === "string" ? notes : "" });
    }
    return Response.json({ ok: true });
  }

  /**
   * Ends [review]'s open Round with its notice: the state and the notice are recorded at
   * once (so a later command is refused), then written, then sent to the page and the
   * listeners. Returns the ended Review.
   */
  async function endRound(
    review: StoredReview,
    end: { type: "finish"; notes: string } | { type: "cancel" },
  ): Promise<StoredReview> {
    const at = new Date().toISOString();
    const fields = { id: recordId("nt"), review_id: review.review_id, round: review.round, at, status: "pending" } as const;
    const notice: StoredNotice = end.type === "finish" ? { type: "finish", ...fields, notes: end.notes } : { type: "cancel", ...fields };
    const ended: StoredReview = { ...review, state: end.type === "finish" ? "finished" : "cancelled" };
    await Promise.all([store.save(ended), records.addNotice(notice)]);
    log(`${ended.state} round ${ended.round} of Review ${ended.review_id}`);
    pageRounds.publish(roundOf(ended));
    await listeners.noticeStored(notice);
    return ended;
  }

  async function page(request: Request, review: StoredReview, path: string, search: string): Promise<Response> {
    let running;
    try {
      running = await pages.page(review);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      log(`page of Review ${review.review_id} failed to start: ${message}`);
      return error(502, `page failed to start: ${message}`);
    }
    const answer = await pages.forward(request, running, path, search);
    // Loading the page itself (not its API calls) is what the list reports as `last_page_open`.
    if (request.method === "GET" && path === "/" && answer.ok) {
      const pinned = await pinRound(answer, (store.get(review.review_id) ?? review).round);
      // Read again after the page's HTML arrived: a Cancel or reopen meanwhile must stand.
      const current = store.get(review.review_id) ?? review;
      const at = new Date().toISOString();
      await store.save({ ...current, last_page_open: at });
      listeners.pageOpened({ type: "page_open", review_id: current.review_id, round: current.round, at });
      return pinned;
    }
    return answer;
  }

  const server = Bun.serve<ListenData>({
    hostname,
    port: options.port,
    // Page streams (the client-lease SSE) stay open for as long as the tab does.
    idleTimeout: 0,
    fetch: route,
    websocket: listeners.websocket,
  });
  const url = `http://${hostname}:${server.port}`;
  origins = {
    local: url,
    public: PUBLIC_ORIGIN,
    temporary: options.temporaryOrigin ?? DEFAULT_TEMPORARY_ORIGIN,
  };
  log(`review service listening on ${url} with ${store.all().length} Review(s) in ${store.dir}`);

  return {
    url,
    port: server.port ?? options.port,
    stop: async () => {
      listeners.stop();
      pageRounds.stop();
      await pages.stopAll();
      server.stop(true);
      await records.settled();
    },
  };
}

async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return MALFORMED;
  }
}

/** The page's HTML with the Round it is loaded in, which its commands then carry (`page-round.ts`). */
async function pinRound(answer: Response, round: number): Promise<Response> {
  if (!answer.headers.get("content-type")?.includes("text/html")) return answer;
  const html = await answer.text();
  const headers = new Headers(answer.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  const meta = `<meta name="${PAGE_ROUND_META}" content="${round}">`;
  const at = html.indexOf("<head>");
  const pinned = at === -1 ? meta + html : `${html.slice(0, at + 6)}${meta}${html.slice(at + 6)}`;
  return new Response(pinned, { status: answer.status, statusText: answer.statusText, headers });
}

function roundOf(review: StoredReview): Round {
  return { review_id: review.review_id, round: review.round, state: review.state };
}

/**
 * Why a page command for [requested] (the Round the page shows; undefined when it sent
 * none) may not act on [review]: its current Round ended, or the page shows another.
 */
function roundRefusal(review: StoredReview, requested: number | undefined): RoundRefusal | undefined {
  // As in Lavish, an ended current Round refuses whatever Round the page names.
  if (review.state !== "open") {
    return {
      status: "ended",
      error: `round ${review.round} has ended`,
      round: review.round,
      state: review.state,
      ended_by: review.state === "finished" ? "user" : "agent",
    } satisfies EndedRoundResponse;
  }
  if (requested === undefined || requested === review.round) return undefined;
  return { status: "stale-round", error: `round ${requested} is not open; the Review is in round ${review.round}`, round: review.round };
}

/** [key] of [value] when it is an object holding it; read as unknown, for the caller to check. */
function field(value: unknown, key: string): unknown {
  return value !== null && typeof value === "object" && key in value ? Reflect.get(value, key) : undefined;
}

function error(status: number, message: string): Response {
  return Response.json({ error: message } satisfies ErrorResponse, { status });
}
