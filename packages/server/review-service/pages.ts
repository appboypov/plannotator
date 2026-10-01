import type { ReviewId } from "@plannotator/shared/review-api";
import type { StoredReview } from "./store.ts";

/** One Review's running upstream annotate server, on its own loopback port. */
export type ReviewPage = {
  port: number;
  stop: () => void;
};

/** Starts the upstream annotate server for [review]'s document; rejects when it cannot. */
export type StartReviewPage = (review: StoredReview) => Promise<ReviewPage>;

/** Request headers the service does not pass to a page server. */
const DROPPED_HEADERS = ["host", "connection", "keep-alive"];

/**
 * The pages of the service's Reviews. Each Review gets its own upstream annotate
 * server, started on the first request for its page and kept while the service runs,
 * so upstream's per-server state (decision, client lease, drafts) stays per Review.
 * The service forwards `/plannotator/session/<id>/<rest>` to `/<rest>` on that server.
 */
export class ReviewPages {
  private readonly pages = new Map<ReviewId, Promise<ReviewPage>>();

  constructor(private readonly start: StartReviewPage) {}

  /** The running page of [review], started once however many requests wait on it. */
  page(review: StoredReview): Promise<ReviewPage> {
    const running = this.pages.get(review.review_id);
    if (running) return running;
    const starting = this.start(review);
    this.pages.set(review.review_id, starting);
    // A failed start is forgotten, so the next request tries again.
    starting.catch(() => {
      if (this.pages.get(review.review_id) === starting) this.pages.delete(review.review_id);
    });
    return starting;
  }

  /** Sends [request] to [page] at [path] (with its leading slash) and streams the answer back. */
  async forward(request: Request, page: ReviewPage, path: string, search: string): Promise<Response> {
    const headers = new Headers(request.headers);
    for (const name of DROPPED_HEADERS) headers.delete(name);
    // Bodies pass through as the page server wrote them, so no encoding is negotiated on the hop.
    headers.set("accept-encoding", "identity");
    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    const answer = await fetch(`http://127.0.0.1:${page.port}${path}${search}`, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      redirect: "manual",
      signal: request.signal,
    });
    return new Response(answer.body, { status: answer.status, statusText: answer.statusText, headers: answer.headers });
  }

  /**
   * Stops [reviewId]'s page, if one started, so its next request starts it again with
   * the document as it is then (a new Round). Upstream's stop also closes the process's
   * file-browser watchers; open pages' streams reconnect.
   */
  async stop(reviewId: ReviewId): Promise<void> {
    const starting = this.pages.get(reviewId);
    if (!starting) return;
    this.pages.delete(reviewId);
    const page = await starting.catch(() => undefined);
    page?.stop();
  }

  /** Stops every page that started. */
  async stopAll(): Promise<void> {
    const starting = [...this.pages.values()];
    this.pages.clear();
    for (const page of await Promise.allSettled(starting)) {
      if (page.status === "fulfilled") page.value.stop();
    }
  }
}
