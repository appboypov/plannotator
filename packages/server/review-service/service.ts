/**
 * The fork's review service (`plannotator serve`): one long-lived server on
 * 127.0.0.1 that serves many documents, each as a Review with a lasting id, link and
 * folder. It answers the review API v1 routes built so far (version, open, list,
 * visibility), health, and every Review's page under `/plannotator/session/<id>/`,
 * which it forwards to that Review's own upstream annotate server (see `pages.ts`).
 * Contract: docs/review-api.md. Remarks, the listen socket, Replies and Cancel come
 * with later stories; until then their routes answer 404 like any unknown route.
 */
import { realpath, stat } from "node:fs/promises";
import {
  API_VERSION,
  DEFAULT_TEMPORARY_ORIGIN,
  ERRORS,
  HEALTH_PATH,
  PUBLIC_ORIGIN,
  REVIEWS_PATH,
  SESSION_PATH_PREFIX,
  VERSION_PATH,
  isLocalRequest,
  parseListReviewsQuery,
  parseOpenReviewRequest,
  parseVisibilityRequest,
  reviewLink,
  reviewPagePath,
  type ErrorResponse,
  type HealthResponse,
  type LinkOrigins,
  type ListReviewsResponse,
  type OpenReviewResponse,
  type Review,
  type VisibilityResponse,
} from "@plannotator/shared/review-api";
import type { Server } from "bun";
import { ReviewPages, type StartReviewPage } from "./pages.ts";
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
};

export type ReviewService = {
  /** The service's own origin, such as `http://127.0.0.1:4397`. */
  url: string;
  port: number;
  /** Stops every page and the server. Review state stays on disk. */
  stop: () => Promise<void>;
};

const VISIBILITY_ROUTE = new RegExp(`^${REVIEWS_PATH}/([^/]+)/visibility$`);
const MALFORMED = Symbol("malformed JSON");

/** Loads the Reviews under `reviewsDir` and starts serving them. */
export async function startReviewService(options: ReviewServiceOptions): Promise<ReviewService> {
  const hostname = options.hostname ?? "127.0.0.1";
  const log = options.log ?? ((line: string) => console.error(`[plannotator] ${line}`));
  const store = await ReviewStore.load(options.reviewsDir, log);
  const pages = new ReviewPages(options.startPage);
  let origins: LinkOrigins;

  const summary = (review: StoredReview): Review => ({
    ...review,
    link: reviewLink(review.review_id, review.visibility, origins),
    // No Remark or listener exists before stories 1.5 and 1.6.
    open_item_count: 0,
    listeners: [],
  });

  async function route(request: Request, server: Server<undefined>): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;
    const headers = request.headers;
    const fromThisMac = isLocalRequest(
      { host: headers.get("host"), origin: headers.get("origin"), referer: headers.get("referer") },
      server.port ?? 0,
      method === "POST",
    );
    if (!fromThisMac) return error(403, ERRORS.forbidden);

    if (method === "GET" && pathname === VERSION_PATH) return Response.json(API_VERSION);
    if (method === "GET" && pathname === HEALTH_PATH) {
      return Response.json({ ok: true, app: "plannotator", version: options.version, api: API_VERSION } satisfies HealthResponse);
    }
    if (pathname === REVIEWS_PATH && method === "POST") return open(await readJson(request));
    if (pathname === REVIEWS_PATH && method === "GET") return list(url.searchParams.get("file"));

    const visibilityMatch = method === "POST" ? VISIBILITY_ROUTE.exec(pathname) : null;
    if (visibilityMatch) {
      const review = store.get(decodeURIComponent(visibilityMatch[1]));
      if (!review) return error(404, ERRORS.reviewNotFound);
      return setVisibility(review, await readJson(request));
    }

    if (pathname.startsWith(SESSION_PATH_PREFIX)) {
      const [reviewId, ...rest] = pathname.slice(SESSION_PATH_PREFIX.length).split("/");
      const review = store.get(reviewId);
      if (!review) return error(404, ERRORS.reviewNotFound);
      // The page calls its API relative to its own path, which needs the trailing slash.
      if (rest.length === 0) return Response.redirect(`${reviewPagePath(reviewId)}${url.search}`, 308);
      return page(request, review, `/${rest.join("/")}`, url.search);
    }
    return error(404, "not found");
  }

  async function open(body: unknown): Promise<Response> {
    if (body === MALFORMED) return error(400, "malformed JSON");
    const parsed = parseOpenReviewRequest(body);
    if (!parsed.ok) return error(400, parsed.error);
    const { file: requested, visibility } = parsed.value;
    const found = await stat(requested).catch(() => undefined);
    if (!found?.isFile()) return error(404, `file not found: ${requested}`);
    const file = await realpath(requested);
    const reviewId = reviewIdForFile(file);
    const existing = store.get(reviewId);
    // Ended Rounds and `reopen` arrive with story 1.6; until then a Review stays in its Round.
    const review: StoredReview = existing
      ? { ...existing, visibility: visibility ?? existing.visibility }
      : {
          review_id: reviewId,
          file,
          visibility: visibility ?? "local",
          round: 1,
          state: "open",
          round_opened_at: new Date().toISOString(),
          last_page_open: null,
        };
    if (!existing || review.visibility !== existing.visibility) await store.save(review);
    if (!existing) log(`opened Review ${reviewId} for ${file}`);
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
      .map((review) => (canonical === undefined ? summary(review) : { ...summary(review), open_items: [] }));
    return Response.json({ reviews } satisfies ListReviewsResponse);
  }

  async function setVisibility(review: StoredReview, body: unknown): Promise<Response> {
    if (body === MALFORMED) return error(400, "malformed JSON");
    const parsed = parseVisibilityRequest(body);
    if (!parsed.ok) return error(400, parsed.error);
    const updated = { ...review, visibility: parsed.value.visibility };
    if (updated.visibility !== review.visibility) await store.save(updated);
    return Response.json({
      review_id: updated.review_id,
      visibility: updated.visibility,
      link: reviewLink(updated.review_id, updated.visibility, origins),
    } satisfies VisibilityResponse);
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
      const current = store.get(review.review_id) ?? review;
      await store.save({ ...current, last_page_open: new Date().toISOString() });
    }
    return answer;
  }

  const server = Bun.serve({
    hostname,
    port: options.port,
    // Page streams (the client-lease SSE) stay open for as long as the tab does.
    idleTimeout: 0,
    fetch: route,
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
      await pages.stopAll();
      server.stop(true);
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

function error(status: number, message: string): Response {
  return Response.json({ error: message } satisfies ErrorResponse, { status });
}
