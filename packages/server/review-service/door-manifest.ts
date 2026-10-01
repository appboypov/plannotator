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

/** The methods a door passes per path under a Review page: its HTML, the calls the page makes, its streams. */
const DOOR_PAGE_ROUTES: Record<string, readonly string[]> = {
  // The page without its trailing slash answers a redirect to it.
  "": ["GET", "HEAD"],
  "/": ["GET", "HEAD"],
  "/favicon.png": ["GET", "HEAD"],
  "/api/plan": ["GET"],
  "/api/plan/version": ["GET"],
  "/api/plan/versions": ["GET"],
  "/api/draft": ["GET", "POST", "DELETE"],
  "/api/feedback": ["POST"],
  "/api/approve": ["POST"],
  "/api/exit": ["POST"],
  [`/${PAGE_ROUND_PATH}`]: ["GET"],
  [`/${PAGE_REPLIES_PATH}`]: ["GET"],
  [ANNOTATE_CLIENT_LEASE_STREAM_PATH]: ["GET"],
};

/** What [method] on [pathname] asks a door for, or null when the manifest does not list it. */
export function matchDoorRequest(method: string, pathname: string): DoorMatch | null {
  if (pathname === HEALTH_PATH) return method === "GET" || method === "HEAD" ? { kind: "health" } : null;
  if (!pathname.startsWith(SESSION_PATH_PREFIX)) return null;
  const rest = pathname.slice(SESSION_PATH_PREFIX.length);
  const slash = rest.indexOf("/");
  const reviewId = slash === -1 ? rest : rest.slice(0, slash);
  const path = slash === -1 ? "" : rest.slice(slash);
  if (!isReviewId(reviewId)) return null;
  const methods = Object.hasOwn(DOOR_PAGE_ROUTES, path) ? DOOR_PAGE_ROUTES[path] : undefined;
  return methods?.includes(method) ? { kind: "page", reviewId, path } : null;
}
