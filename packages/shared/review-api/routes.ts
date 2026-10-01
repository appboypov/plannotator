import type { ReviewId, Visibility } from "./types.ts";

/** The service's own port on 127.0.0.1: API, listen socket, pages, health. */
export const SERVICE_PORT = 4397;

/** The temporary door on 127.0.0.1, for ngrok: only `temporary` Reviews. */
export const TEMPORARY_PORT = 4398;

/** The public door on the Tailscale address, for the VPS: only `public` Reviews. */
export const PUBLIC_PORT = 4399;

/** The origin a `public` Review's link lives on. */
export const PUBLIC_ORIGIN = "https://ctas.de-appspecialist.nl";

/** The origin a `temporary` Review's link lives on until a setting names another. */
export const DEFAULT_TEMPORARY_ORIGIN = "https://knowledgeably-supersweet-kizzie.ngrok-free.dev";

/** Unversioned: any client reads the major here before it uses a versioned route. */
export const VERSION_PATH = "/api/review/version";

/** `POST` opens a Review, `GET` lists them. */
export const REVIEWS_PATH = "/api/review/v1/reviews";

/** The WebSocket listen socket; `?session=<omp session id>` is required. */
export const LISTEN_PATH = "/api/review/v1/listen";

/** Answers 200 while the service runs. */
export const HEALTH_PATH = "/plannotator/health";

/** Every page lives under this prefix, so ctas routes `/plannotator/*` here. */
export const SESSION_PATH_PREFIX = "/plannotator/session/";

/** `GET`, relative to a Review page's path: the Review's Remarks with their Replies. */
export const PAGE_REPLIES_PATH = "api/review-replies";

/** `POST`: a Reply on a Review. */
export function repliesPath(reviewId: ReviewId): string {
  return `${REVIEWS_PATH}/${encodeURIComponent(reviewId)}/replies`;
}

/** `POST`: cancel a Review's current Round. */
export function cancelPath(reviewId: ReviewId): string {
  return `${REVIEWS_PATH}/${encodeURIComponent(reviewId)}/cancel`;
}

/** `POST`: set a Review's Visibility. */
export function visibilityPath(reviewId: ReviewId): string {
  return `${REVIEWS_PATH}/${encodeURIComponent(reviewId)}/visibility`;
}

/** A Review page's path. The page calls its API relative to it (`<page path>api/...`). */
export function reviewPagePath(reviewId: ReviewId): string {
  return `${SESSION_PATH_PREFIX}${reviewId}/`;
}

/** Where each Visibility's links live. */
export type LinkOrigins = {
  /** The service's own address, such as `http://127.0.0.1:4397`. */
  local: string;
  public: string;
  temporary: string;
};

/** A Review's link for its Visibility: the same page path on the Visibility's origin. */
export function reviewLink(reviewId: ReviewId, visibility: Visibility, origins: LinkOrigins): string {
  return `${origins[visibility]}${reviewPagePath(reviewId)}`;
}
