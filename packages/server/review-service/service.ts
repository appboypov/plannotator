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
import { randomBytes } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { canonicalPRSubject } from "@plannotator/shared/review-api/subject";
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
import { startDoor, type Door, type DoorListen } from "./doors.ts";
import { DOOR_FILE_CONTENT_PATH, PR_DOOR_READ_ROUTES, doorReadsPatchFile } from "./door-manifest.ts";
import { ReviewPages, type StartReviewPage } from "./pages.ts";
import { ReviewRecords, openRemark, recordId, remarksFromFeedback, type StoredNotice } from "./records.ts";
import { ReviewStore, reviewIdForFile, type StoredReview } from "./store.ts";
import { TEMPORARY_DOOR_HOST } from "./settings.ts";
import { MulticaPoster } from "./multica-poster.ts";

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
  /** The origin of `temporary` links and the one host the temporary door answers; the fixed ngrok address when absent. */
  temporaryOrigin?: string;
  /** The LaunchAgent label health names when launchd runs the service (`plannotator service install`). */
  serviceLabel?: string;
  log?: (line: string) => void;
  /** How often listeners are pinged; the contract's 30 seconds unless a test names another. */
  heartbeatMs?: number;
  /** The public door for ctas (ADR 0007); none when null or absent. */
  publicDoor?: DoorListen | null;
  /** The temporary door for ngrok on 127.0.0.1:<port>, accepting only loopback (ADR 0007); none when null or absent. */
  temporaryPort?: number | null;
  /** Requests per visitor per minute through a door; 300 unless a test names another. */
  doorRateLimit?: number;
  /** CLI profile for member comments on linked Reviews; absent disables linking. */
  multicaProfile?: string | null;
  /** Profile root override for isolated tests; production uses the service's HOME. */
  multicaHome?: string;
};

export type ReviewService = {
  /** The service's own origin, such as `http://127.0.0.1:4397`. */
  url: string;
  port: number;
  /** The doors that were started, bound or still retrying their bind. */
  doors: Door[];
  /** Stops every page, the doors and the server. Review state stays on disk. */
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
    (reviewId) => store.get(reviewId)?.issue ?? null,
  );
  const listeners = new ReviewListeners(records, log, options.heartbeatMs, (id) => !!store.get(id)?.issue);
  const pages = new ReviewPages(options.startPage);
  const pageRounds = new PageRounds();
  let origins: LinkOrigins;
  const doors: Door[] = [];

  const summary = ({ round_head: _roundHead, ...review }: StoredReview): Review => ({
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
    if (method === "GET" && pathname === HEALTH_PATH) return health();
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

    if (pathname.startsWith(SESSION_PATH_PREFIX)) return sessionRoute(request);
    return error(404, "not found");
  }

  function health(): Response {
    return Response.json({
      ok: true,
      app: "plannotator",
      version: options.version,
      api: API_VERSION,
      ...(options.serviceLabel ? { service: { label: options.serviceLabel } } : {}),
    } satisfies HealthResponse);
  }

  /** A Review page path (`/plannotator/session/<id>/...`), from this Mac or through a door. */
  async function sessionRoute(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;
    const [reviewId, ...rest] = url.pathname.slice(SESSION_PATH_PREFIX.length).split("/");
    const review = store.get(reviewId);
    if (!review) return error(404, ERRORS.reviewNotFound);
    // The page calls its API relative to its own path, which needs the trailing slash.
    if (rest.length === 0) return Response.redirect(`${reviewPagePath(reviewId)}${url.search}`, 308);
    const path = `/${rest.join("/")}`;
    // PR read routes behind a door belong only to a PR subject, never to a local file page.
    if (url.hostname === "door" && Object.hasOwn(PR_DOOR_READ_ROUTES, path)
      && !canonicalPRSubject(review.file)) return error(404, "not found");
    const command = method === "POST" ? PAGE_COMMANDS[path] : undefined;
    if (command) return pageCommand(command, review, request, url);
    if (method === "GET" && path === ROUND_STREAM_PATH) return pageRounds.stream(roundOf(review));
    if (method === "GET" && path === REPLIES_PAGE_PATH) return Response.json(records.page(review.review_id));
    return page(request, review, path, url.search);
  }

  async function open(body: unknown): Promise<Response> {
    if (body === MALFORMED) return error(400, "malformed JSON");
    const parsed = parseOpenReviewRequest(body);
    if (!parsed.ok) return error(400, parsed.error);
    const { file: requested, visibility, reopen, issue } = parsed.value;
    if (issue && !options.multicaProfile?.trim()) return error(400, ERRORS.multicaProfile);
    let file = canonicalPRSubject(requested);
    const pr = file !== undefined;
    if (!file) {
      const found = await stat(requested).catch(() => undefined);
      if (!found?.isFile()) return error(404, `file not found: ${requested}`);
      file = await realpath(requested);
    }
    let existing = store.find(file);
    // A PR URL is public, so a PR Review's id, the secret part of its door link, is random (ADR 0009).
    const reviewId = existing?.review_id ?? (pr ? randomBytes(8).toString("hex") : reviewIdForFile(file));
    // Only a PR Round whose page has shown a head can show a moved one.
    if (existing?.state === "open" && existing.round_head !== undefined) {
      let moved: boolean;
      try {
        // The running page, or after a restart a page started now on the current head.
        const running = await pages.page(existing);
        moved = running.head !== existing.round_head || ((await running.headMoved?.()) ?? false);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        log(`could not read the head of ${file} for Review ${reviewId}: ${message}`);
        return error(502, `could not read the pull request's head: ${message}`);
      }
      // An Approve, Close or Cancel may have landed while the head was read.
      const current = store.get(reviewId) ?? existing;
      // A Round shows the head its first page fetched: a moved head cancels the Round, so the next Round
      // below shows the head as it is now and an Approve passes only what the reviewer saw.
      if (moved && current.state === "open" && current.round === existing.round) {
        log(`head of ${file} moved since round ${current.round} of Review ${reviewId} started`);
        existing = await endRound(current, { type: "cancel" });
      } else existing = current;
    }
    if (existing && issue && (existing.issue?.id !== issue.id || existing.issue.workspace_id !== issue.workspace_id)) {
      existing = { ...existing, issue };
      await store.save(existing);
      // The Finish to bind is that of the Round the Review is in after this open: a reopen starts the next one.
      const finishedStays = existing.state === "finished" && !reopen;
      await records.relink(reviewId, issue, existing.state === "open" || finishedStays ? existing.round : existing.round + 1);
      poster.wake(reviewId, true);
      // An Approve, Close or Cancel may have landed during the writes above.
      existing = store.get(reviewId) ?? existing;
    }
    // The reviewer's Approve stands until the agent asks to reopen it; linking may still update its destination.
    if (existing?.state === "finished" && !reopen) {
      return Response.json({
        review_id: reviewId,
        link: reviewLink(reviewId, existing.visibility, origins),
        status: "user-ended",
        round: existing.round,
        visibility: existing.visibility,
        issue: existing.issue,
      } satisfies OpenReviewResponse);
    }
    const now = new Date().toISOString();
    const nextRound = existing !== undefined && existing.state !== "open";
    const review: StoredReview = existing
      ? {
          ...existing,
          visibility: visibility ?? existing.visibility,
          ...(nextRound ? { round: existing.round + 1, state: "open", round_opened_at: now, round_head: undefined } : {}),
        }
      : {
          review_id: reviewId,
          file,
          visibility: visibility ?? "local",
          issue: issue ?? null,
          round: 1,
          state: "open",
          round_opened_at: now,
          last_page_open: null,
        };
    if (!existing || nextRound || review.visibility !== existing.visibility) await store.save(review);
    if (!existing && issue) {
      await records.relink(reviewId, issue, review.round);
      poster.wake(reviewId, true);
    }
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
      issue: review.issue,
    } satisfies OpenReviewResponse);
  }

  async function list(fileQuery: string | null): Promise<Response> {
    const parsed = parseListReviewsQuery(fileQuery);
    if (!parsed.ok) return error(400, parsed.error);
    const { file } = parsed.value;
    const canonical = file === undefined ? undefined : canonicalPRSubject(file) ?? await realpath(file).catch(() => file);
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
    // A door stops serving the Review at once: its open requests through the door close.
    for (const door of doors) door.revoke(updated.review_id, updated.visibility);
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
   *   gate lets a dismissed review pass, and marks the notice `dismissed` so a client that
   *   prints upstream's decisions (`plannotator annotate`) can tell it from an Approve.
   *   Its `round` and draft generation are queries.
   * A `round` that is not the open Round answers 409 and writes nothing. The service first
   * clears the sent draft on the page server, as upstream's own routes do; when that
   * fails nothing is stored, so a reload cannot bring back what was already sent.
   */
  async function pageCommand(command: PageCommand, review: StoredReview, request: Request, url: URL): Promise<Response> {
    const body = command === "exit" ? {} : await readJson(request);
    if (body === MALFORMED) return error(400, "malformed JSON");
    if (command === "feedback" && canonicalPRSubject(review.file) && field(body, "approved") === true) command = "approve";
    const roundQuery = url.searchParams.get("round");
    const round = parsePageRound(command === "exit" ? (roundQuery === null ? undefined : Number(roundQuery)) : field(body, "round"));
    if (!round.ok) return error(400, round.error);
    // Read again after the body arrived, before anything is cleared: a Round that ended or
    // moved on while the body was in flight refuses the command and keeps its draft.
    const arrived = store.get(review.review_id) ?? review;
    const refused = roundRefusal(arrived, round.value);
    if (refused) return Response.json(refused satisfies RoundRefusal, { status: 409 });

    const generation = command === "exit" ? url.searchParams.get("draftGeneration") : field(body, "draftGeneration");
    const search = typeof generation === "number" || typeof generation === "string" ? `?generation=${generation}` : "";
    const cleared = await page(new Request(request.url, { method: "DELETE" }), arrived, DRAFT_PATH, search);
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
        if (current.issue) poster.wake(current.review_id);
        log(`stored ${added.length} Remark(s) for Review ${current.review_id} round ${current.round}`);
        await listeners.remarksStored(current.review_id, added);
      }
    } else {
      const notes = field(body, "feedback");
      await endRound(
        current,
        command === "exit"
          ? { type: "finish", notes: "", dismissed: true }
          : { type: "finish", notes: typeof notes === "string" ? notes : "" },
      );
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
    end: { type: "finish"; notes: string; dismissed?: true } | { type: "cancel" },
  ): Promise<StoredReview> {
    const at = new Date().toISOString();
    const fields = { id: recordId("nt"), review_id: review.review_id, round: review.round, at, status: "pending" } as const;
    const notice: StoredNotice =
      end.type === "finish"
        ? { type: "finish", ...fields, notes: end.notes, ...(end.dismissed ? { dismissed: true as const } : {}) }
        : { type: "cancel", ...fields };
    const ended: StoredReview = { ...review, state: end.type === "finish" ? "finished" : "cancelled" };
    await Promise.all([store.save(ended), records.addNotice(notice)]);
    if (notice.multica) poster.wake(review.review_id);
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
    // Through a door, file expansion stays in the Round's patch: the page server would read any path with the provider token.
    const shown = store.get(review.review_id) ?? review;
    // The Round's first page fixes the head the Round shows, so an open after a restart can tell it moved.
    if (running.head !== undefined && shown.state === "open" && shown.round === review.round && shown.round_head === undefined) {
      await store.save({ ...shown, round_head: running.head });
    }
    if (new URL(request.url).hostname === "door" && path === DOOR_FILE_CONTENT_PATH
      && !doorReadsPatchFile(running.patch, new URLSearchParams(search))) return error(404, "not found");
    const answer = await pages.forward(request, running, path, search);
    // Loading the page itself (not its API calls) is what the list reports as `last_page_open`.
    if (request.method === "GET" && path === "/" && answer.ok) {
      const pinned = await pinRound(answer, (store.get(review.review_id) ?? review).round);
      // Read again after the page's HTML arrived: a Cancel or reopen meanwhile must stand.
      const current = store.get(review.review_id) ?? review;
      await store.save({ ...current, last_page_open: new Date().toISOString() });
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
  const poster = new MulticaPoster({
    records, profile: options.multicaProfile ?? null, home: options.multicaHome, log,
    reviewOf: (id) => {
      const review = store.get(id);
      return review ? { file: review.file, link: reviewLink(id, review.visibility, origins) } : undefined;
    },
  });
  log(`review service listening on ${url} with ${store.all().length} Review(s) in ${store.dir}`);

  const doorOptions = {
    visibilityOf: (reviewId: string) => store.get(reviewId)?.visibility,
    health,
    page: sessionRoute,
    log,
    limit: options.doorRateLimit,
  };
  if (options.publicDoor) {
    const { host } = options.publicDoor;
    doors.push(
      startDoor({
        ...options.publicDoor,
        ...doorOptions,
        visibility: "public",
        // Caddy passes the visitor's Host (ctas); the VPS may also call the door's own address.
        hostnames: [new URL(PUBLIC_ORIGIN).hostname, host],
      }),
    );
  }
  if (options.temporaryPort !== undefined && options.temporaryPort !== null) {
    doors.push(
      startDoor({
        host: TEMPORARY_DOOR_HOST,
        port: options.temporaryPort,
        // ngrok's agent runs on this Mac; nothing else may connect.
        peer: TEMPORARY_DOOR_HOST,
        ...doorOptions,
        visibility: "temporary",
        // ngrok passes the visitor's Host: only the link's own host is answered.
        hostnames: [new URL(origins.temporary).hostname],
      }),
    );
  }

  return {
    url,
    port: server.port ?? options.port,
    doors,
    stop: async () => {
      listeners.stop();
      pageRounds.stop();
      await Promise.all(doors.map((door) => door.stop()));
      await pages.stopAll();
      server.stop(true);
      await poster.stop();
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
