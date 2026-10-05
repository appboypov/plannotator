import { createHash, randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseReviewSubject } from "@plannotator/shared/review-api/subject";
import { isReviewId, VISIBILITIES, type Review, type ReviewId } from "@plannotator/shared/review-api";

/** A Review's state file inside its own folder: `<reviews dir>/<review_id>/review.json`. */
export const REVIEW_FILE = "review.json";

/** What a Review keeps on disk; the list adds its link, Remark count and listeners. */
export type StoredReview = Pick<
  Review,
  "review_id" | "file" | "visibility" | "round" | "state" | "round_opened_at" | "last_page_open"
>;

const STATES: readonly string[] = ["open", "finished", "cancelled"];

/** A Review's id: the first 16 hex characters of the SHA-256 of its canonical subject. */
export function reviewIdForFile(canonicalFile: string): ReviewId {
  return createHash("sha256").update(canonicalFile).digest("hex").slice(0, 16);
}

/**
 * The Reviews of one service: every Review in memory, each written to its own folder
 * so it survives a restart. A folder whose `review.json` is unreadable or malformed is
 * skipped at load with one log line and left on disk untouched.
 */
export class ReviewStore {
  private readonly writes = new Map<ReviewId, Promise<void>>();

  private constructor(
    readonly dir: string,
    private readonly reviews: Map<ReviewId, StoredReview>,
  ) {}

  /** Reads every Review folder under [dir], creating [dir] when it is missing. */
  static async load(
    dir: string,
    log: (line: string) => void = (line) => console.error(`[plannotator] ${line}`),
  ): Promise<ReviewStore> {
    await mkdir(dir, { recursive: true });
    const reviews = new Map<ReviewId, StoredReview>();
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !isReviewId(entry.name)) continue;
      const path = join(dir, entry.name, REVIEW_FILE);
      const review = await readFile(path, "utf8")
        .then((text) => parseStoredReview(JSON.parse(text), entry.name))
        .catch(() => undefined);
      if (review) reviews.set(review.review_id, review);
      else log(`skipped unreadable Review state ${path}`);
    }
    return new ReviewStore(dir, reviews);
  }

  get(reviewId: ReviewId): StoredReview | undefined {
    return this.reviews.get(reviewId);
  }

  all(): StoredReview[] {
    return [...this.reviews.values()];
  }

  /** The folder that holds this Review's state; later stories keep Remarks and Replies here. */
  folder(reviewId: ReviewId): string {
    return join(this.dir, reviewId);
  }

  /**
   * Records [review] in memory at once, then replaces its `review.json` atomically.
   * Writes of one Review run one after another and each writes the latest state, so an
   * older save never lands over a newer one.
   */
  save(review: StoredReview): Promise<void> {
    const reviewId = review.review_id;
    this.reviews.set(reviewId, review);
    const previous = this.writes.get(reviewId) ?? Promise.resolve();
    const next = previous.then(async () => {
      const folder = this.folder(reviewId);
      await mkdir(folder, { recursive: true });
      const temporary = join(folder, `.${REVIEW_FILE}.${randomBytes(6).toString("hex")}.tmp`);
      await writeFile(temporary, `${JSON.stringify(this.reviews.get(reviewId), null, 2)}\n`);
      await rename(temporary, join(folder, REVIEW_FILE));
    });
    // A failed write must not stop the next one; the caller of this one sees the failure.
    this.writes.set(reviewId, next.catch(() => {}));
    return next;
  }
}

/** [value] as a stored Review of folder [folderId], or undefined when any field is off. */
export function parseStoredReview(value: unknown, folderId: string): StoredReview | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const fields = value as Record<string, unknown>;
  const { review_id, file, visibility, round, state, round_opened_at, last_page_open } = fields;
  if (review_id !== folderId || !isReviewId(review_id)) return undefined;
  if (typeof file !== "string" || !parseReviewSubject(file).ok) return undefined;
  if (!VISIBILITIES.includes(visibility as never)) return undefined;
  if (typeof round !== "number" || !Number.isInteger(round) || round < 1) return undefined;
  if (typeof state !== "string" || !STATES.includes(state)) return undefined;
  if (!isTimeOrNull(round_opened_at) || !isTimeOrNull(last_page_open)) return undefined;
  return {
    review_id,
    file,
    visibility: visibility as StoredReview["visibility"],
    round,
    state: state as StoredReview["state"],
    round_opened_at,
    last_page_open,
  };
}

function isTimeOrNull(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && !Number.isNaN(Date.parse(value)));
}
