/**
 * Remarks: each annotation the reviewer sends with Send feedback, stored in its
 * Review's folder (`<reviews dir>/<review_id>/remarks.json`) so it waits for a
 * listener across sessions and restarts. A Remark stays open until a Reply answers
 * it (story 1.8) and reaches each listener session once: the sessions it was
 * delivered to are stored with it.
 */
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { IsoTime, OpenRemark, Remark, RemarkEvent, ReviewId, SessionId } from "@plannotator/shared/review-api";

/** A Review's Remarks file inside its own folder. */
export const REMARKS_FILE = "remarks.json";

/** What the service keeps per Remark: the Remark, when it was stored, and who has it. */
export type StoredRemark = Remark & {
  at: IsoTime;
  status: "open" | "answered";
  /** Listener sessions the Remark was delivered to, each once, in delivery order. */
  delivered_to: SessionId[];
};

/**
 * The Remarks of one Send feedback: one per entry of the page's `annotations`, in
 * order. The page's other fields (the formatted `feedback`, code annotations, the
 * draft generation) are not Remarks. A body without an `annotations` array has none.
 */
export function remarksFromFeedback(
  body: unknown,
  review: { review_id: ReviewId; round: number },
  at: IsoTime,
): StoredRemark[] {
  const annotations = field(body, "annotations");
  if (!Array.isArray(annotations)) return [];
  return annotations.map((annotation: unknown): StoredRemark => {
    return {
      id: `fi_${randomBytes(12).toString("hex")}`,
      review_id: review.review_id,
      round: review.round,
      text: text(field(annotation, "text")),
      anchor: {
        selector: text(field(annotation, "blockId")),
        tag: text(field(annotation, "type")).toLowerCase(),
        text: text(field(annotation, "originalText")),
      },
      at,
      status: "open",
      delivered_to: [],
    };
  });
}

/** [remark] as the listen socket's frame. */
export function remarkEvent(remark: StoredRemark): RemarkEvent {
  const { id, review_id, round, text, anchor } = remark;
  return { type: "feedback_item", id, review_id, round, text, anchor };
}

/** [remark] as a one-file list's open item. */
export function openRemark(remark: StoredRemark): OpenRemark {
  const { type: _type, ...fields } = remarkEvent(remark);
  return { ...fields, at: remark.at };
}

/**
 * Every Review's Remarks, in memory and in each Review's folder. Changes apply in
 * memory at once, so a delivery decided right after sees them; each Review's file
 * is then rewritten atomically, one write after another.
 */
export class RemarkStore {
  private readonly writes = new Map<ReviewId, Promise<void>>();

  private constructor(
    private readonly folder: (reviewId: ReviewId) => string,
    private readonly remarks: Map<ReviewId, StoredRemark[]>,
  ) {}

  /** Reads the Remarks of [reviewIds]; a missing file is none, an unreadable one is logged and kept. */
  static async load(
    reviewIds: readonly ReviewId[],
    folder: (reviewId: ReviewId) => string,
    log: (line: string) => void,
  ): Promise<RemarkStore> {
    const remarks = new Map<ReviewId, StoredRemark[]>();
    for (const reviewId of reviewIds) {
      const path = join(folder(reviewId), REMARKS_FILE);
      // null: no file, so no Remarks yet; undefined: a file that cannot be read.
      const text = await readFile(path, "utf8").catch((cause: unknown) =>
        field(cause, "code") === "ENOENT" ? null : undefined,
      );
      if (text === null) continue;
      const stored = text === undefined ? undefined : parseRemarks(text, reviewId);
      if (stored) remarks.set(reviewId, stored);
      else log(`skipped unreadable Remarks ${path}`);
    }
    return new RemarkStore(folder, remarks);
  }

  /** The Reviews holding Remarks, in the order their first Remark was stored or loaded. */
  reviewIds(): ReviewId[] {
    return [...this.remarks.keys()];
  }

  /** The Review's Remarks in store order. */
  of(reviewId: ReviewId): readonly StoredRemark[] {
    return this.remarks.get(reviewId) ?? [];
  }

  /** The Review's open Remarks in store order. */
  open(reviewId: ReviewId): StoredRemark[] {
    return this.of(reviewId).filter((remark) => remark.status === "open");
  }

  /** Appends [added] to the Review's Remarks and writes them. */
  add(reviewId: ReviewId, added: readonly StoredRemark[]): Promise<void> {
    this.remarks.set(reviewId, [...this.of(reviewId), ...added]);
    return this.write(reviewId);
  }

  /** Records that [session] received [ids] of the Review, and writes it. */
  delivered(reviewId: ReviewId, ids: readonly string[], session: SessionId): Promise<void> {
    for (const remark of this.of(reviewId)) {
      if (ids.includes(remark.id) && !remark.delivered_to.includes(session)) remark.delivered_to.push(session);
    }
    return this.write(reviewId);
  }

  /** Waits for every write started so far. */
  async settled(): Promise<void> {
    await Promise.all(this.writes.values());
  }

  private write(reviewId: ReviewId): Promise<void> {
    const previous = this.writes.get(reviewId) ?? Promise.resolve();
    const next = previous.then(async () => {
      const folder = this.folder(reviewId);
      await mkdir(folder, { recursive: true });
      const temporary = join(folder, `.${REMARKS_FILE}.${randomBytes(6).toString("hex")}.tmp`);
      await writeFile(temporary, `${JSON.stringify({ remarks: this.of(reviewId) }, null, 2)}\n`);
      await rename(temporary, join(folder, REMARKS_FILE));
    });
    // A failed write must not stop the next one; the caller of this one sees the failure.
    this.writes.set(reviewId, next.catch(() => {}));
    return next;
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** [key] of [value] when it is an object holding it; read as unknown, for the caller to check. */
function field(value: unknown, key: string): unknown {
  return value !== null && typeof value === "object" && key in value ? Reflect.get(value, key) : undefined;
}

function parseRemarks(text: string, reviewId: ReviewId): StoredRemark[] | undefined {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return undefined;
  }
  const remarks = field(data, "remarks");
  if (!Array.isArray(remarks)) return undefined;
  const stored: StoredRemark[] = [];
  for (const remark of remarks) {
    const parsed = parseRemark(remark, reviewId);
    if (!parsed) return undefined;
    stored.push(parsed);
  }
  return stored;
}

function parseRemark(value: unknown, reviewId: ReviewId): StoredRemark | undefined {
  const id = field(value, "id");
  const round = field(value, "round");
  const remarkText = field(value, "text");
  const anchor = field(value, "anchor");
  const selector = field(anchor, "selector");
  const tag = field(anchor, "tag");
  const excerpt = field(anchor, "text");
  const at = field(value, "at");
  const status = field(value, "status");
  const deliveredTo = field(value, "delivered_to");
  if (typeof id !== "string" || !/^fi_[0-9a-f]{24}$/.test(id)) return undefined;
  if (field(value, "review_id") !== reviewId || typeof round !== "number" || typeof remarkText !== "string") return undefined;
  if (typeof selector !== "string" || typeof tag !== "string" || typeof excerpt !== "string") return undefined;
  if (typeof at !== "string" || (status !== "open" && status !== "answered")) return undefined;
  if (!Array.isArray(deliveredTo) || !deliveredTo.every((session) => typeof session === "string")) return undefined;
  return {
    id,
    review_id: reviewId,
    round,
    text: remarkText,
    anchor: { selector, tag, text: excerpt },
    at,
    status,
    delivered_to: deliveredTo,
  };
}
