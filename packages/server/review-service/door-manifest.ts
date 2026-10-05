/**
 * The one list of what a door (the public door for ctas, the temporary door for
 * ngrok) passes on (ADR 0007). The door answers everything this module does not match
 * with 404: the review API, the listen socket, every other upstream page route (the
 * file browser, images and linked documents from disk, source save, settings, AI)
 * and every WebSocket.
 */
import { HEALTH_PATH, PAGE_REPLIES_PATH, SESSION_PATH_PREFIX, isReviewId, type ReviewId } from "@plannotator/shared/review-api";
import { PAGE_ROUND_PATH } from "@plannotator/shared/review-api/page-round";
import { ANNOTATE_CLIENT_LEASE_STREAM_PATH } from "@plannotator/shared/annotate-client-lease";

/** What a door request asks for: the health check, or a Review page's own path (`""`, `/`, `/api/...`). */
export type DoorMatch = { kind: "health" } | { kind: "page"; reviewId: ReviewId; path: string };

/** A path a door passes: its methods, and the query parameters it may carry (`"any"` for the page's HTML). */
type DoorRoute = { methods: readonly string[]; query: readonly string[] | "any" };

/**
 * The paths a door passes under a Review page: its HTML, the calls the page makes, its
 * streams. Query parameters are listed per path because upstream routes read other
 * documents from them: `api/plan/version(s)` take `path` and `base` to read any
 * linked document's history, so through a door they take only the Review's own `v`.
 */
const DOOR_PAGE_ROUTES: Record<string, DoorRoute> = {
  // The page without its trailing slash answers a redirect to it.
  "": { methods: ["GET", "HEAD"], query: "any" },
  "/": { methods: ["GET", "HEAD"], query: "any" },
  "/favicon.png": { methods: ["GET", "HEAD"], query: [] },
  "/api/plan": { methods: ["GET"], query: [] },
  "/api/plan/version": { methods: ["GET"], query: ["v"] },
  "/api/plan/versions": { methods: ["GET"], query: [] },
  "/api/diff": { methods: ["GET"], query: [] },
  "/api/diff/fresh": { methods: ["GET"], query: ["snapshot"] },
  "/api/pr-context": { methods: ["GET"], query: [] },
  "/api/pr-context/stream": { methods: ["GET"], query: [] },
  "/api/file-content": { methods: ["GET"], query: ["path", "oldPath", "snapshot"] },
  "/api/review-image": { methods: ["GET"], query: ["path", "side", "snapshot"] },
  "/api/draft": { methods: ["GET", "POST", "DELETE"], query: ["generation"] },
  "/api/feedback": { methods: ["POST"], query: [] },
  "/api/approve": { methods: ["POST"], query: [] },
  "/api/exit": { methods: ["POST"], query: ["round", "generation"] },
  [`/${PAGE_ROUND_PATH}`]: { methods: ["GET"], query: [] },
  [`/${PAGE_REPLIES_PATH}`]: { methods: ["GET"], query: [] },
  [ANNOTATE_CLIENT_LEASE_STREAM_PATH]: { methods: ["GET"], query: [] },
};

/** What [method] on [url] asks a door for, or null when the manifest does not list it. */
export function matchDoorRequest(method: string, url: URL): DoorMatch | null {
  const { pathname } = url;
  if (pathname === HEALTH_PATH) return method === "GET" || method === "HEAD" ? { kind: "health" } : null;
  if (!pathname.startsWith(SESSION_PATH_PREFIX)) return null;
  const rest = pathname.slice(SESSION_PATH_PREFIX.length);
  const slash = rest.indexOf("/");
  const reviewId = slash === -1 ? rest : rest.slice(0, slash);
  const path = slash === -1 ? "" : rest.slice(slash);
  if (!isReviewId(reviewId)) return null;
  const route = Object.hasOwn(DOOR_PAGE_ROUTES, path) ? DOOR_PAGE_ROUTES[path] : undefined;
  if (!route?.methods.includes(method)) return null;
  const { query } = route;
  if (query !== "any" && [...url.searchParams.keys()].some((name) => !query.includes(name))) return null;
  return { kind: "page", reviewId, path };
}
