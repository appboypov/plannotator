/**
 * What a Review's listeners hear, stored in the Review's folder so it waits for them
 * across sessions and restarts:
 * - Remarks (`remarks.json`): each annotation the reviewer sends with Send feedback.
 *   A Remark stays open until a Reply answers it (story 1.8) and reaches each listener
 *   session once: the sessions it was delivered to are stored with it.
 * - Notices (`notices.json`): the Finish or Cancel that closed a Round, pending until
 *   any listener acknowledges it.
 */
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  IsoTime,
  Notice,
  OpenRemark,
  Remark,
  RemarkEvent,
  ReviewId,
  SessionId,
} from "@plannotator/shared/review-api";

/** A Review's Remarks file inside its own folder. */
export const REMARKS_FILE = "remarks.json";

/** A Review's notices file inside its own folder. */
export const NOTICES_FILE = "notices.json";

/** What the service keeps per Remark: the Remark, when it was stored, and who has it. */
export type StoredRemark = Remark & {
  at: IsoTime;
  status: "open" | "answered";
  /** Listener sessions the Remark was delivered to, each once, in delivery order. */
  delivered_to: SessionId[];
};

/** What the service keeps per notice: the notice and whether a listener acknowledged it. */
export type StoredNotice = Notice & {
  status: "pending" | "acknowledged";
  acknowledged_at?: IsoTime;
};

/** One record a subscription replays, in the order the Review stored them. */
export type BacklogRecord = { kind: "remark"; remark: StoredRemark } | { kind: "notice"; notice: StoredNotice };

const REMARK_ID = /^fi_[0-9a-f]{24}$/;
const NOTICE_ID = /^nt_[0-9a-f]{24}$/;

/** A new record id: [prefix], an underscore and 24 lowercase hex characters. */
export function recordId(prefix: "fi" | "nt"): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

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
      id: recordId("fi"),
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

/** [notice] as the listen socket's frame. */
export function noticeEvent(notice: StoredNotice): Notice {
  const { status: _status, acknowledged_at: _acknowledged, ...event } = notice;
  return event;
}

/**
 * Every Review's Remarks and notices, in memory and in each Review's folder. Changes
 * apply in memory at once, so a delivery decided right after sees them; each file is
 * then rewritten atomically, one write after another.
 */
export class ReviewRecords {
  private readonly writes = new Map<string, Promise<void>>();

  private constructor(
    private readonly folder: (reviewId: ReviewId) => string,
    private readonly remarks: Map<ReviewId, StoredRemark[]>,
    private readonly notices: Map<ReviewId, StoredNotice[]>,
  ) {}

  /** Reads the records of [reviewIds]; a missing file is none, an unreadable one is logged and kept. */
  static async load(
    reviewIds: readonly ReviewId[],
    folder: (reviewId: ReviewId) => string,
    log: (line: string) => void,
  ): Promise<ReviewRecords> {
    const remarks = new Map<ReviewId, StoredRemark[]>();
    const notices = new Map<ReviewId, StoredNotice[]>();
    for (const reviewId of reviewIds) {
      const dir = folder(reviewId);
      const storedRemarks = await readList(join(dir, REMARKS_FILE), "remarks", (value) => parseRemark(value, reviewId), log);
      if (storedRemarks) remarks.set(reviewId, storedRemarks);
      const storedNotices = await readList(join(dir, NOTICES_FILE), "notices", (value) => parseNotice(value, reviewId), log);
      if (storedNotices) notices.set(reviewId, storedNotices);
    }
    return new ReviewRecords(folder, remarks, notices);
  }

  /** The Reviews holding records, in the order their first record was stored or loaded. */
  reviewIds(): ReviewId[] {
    return [...new Set([...this.remarks.keys(), ...this.notices.keys()])];
  }

  /** The Review's open Remarks in store order. */
  open(reviewId: ReviewId): StoredRemark[] {
    return (this.remarks.get(reviewId) ?? []).filter((remark) => remark.status === "open");
  }

  /**
   * What a subscription that adds the Review replays: its open Remarks and pending
   * notices, merged by when they were stored; a Remark first on a tie, since a Round
   * cannot end before the feedback sent in it.
   */
  backlog(reviewId: ReviewId): BacklogRecord[] {
    const remarks: BacklogRecord[] = this.open(reviewId).map((remark) => ({ kind: "remark", remark }));
    const notices: BacklogRecord[] = (this.notices.get(reviewId) ?? [])
      .filter((notice) => notice.status === "pending")
      .map((notice) => ({ kind: "notice", notice }));
    const at = (record: BacklogRecord) => (record.kind === "remark" ? record.remark.at : record.notice.at);
    const merged: BacklogRecord[] = [];
    while (remarks.length > 0 || notices.length > 0) {
      const takeRemark = notices.length === 0 || (remarks.length > 0 && at(remarks[0]) <= at(notices[0]));
      merged.push((takeRemark ? remarks : notices).shift()!);
    }
    return merged;
  }

  /** Appends [added] to the Review's Remarks and writes them. */
  addRemarks(reviewId: ReviewId, added: readonly StoredRemark[]): Promise<void> {
    this.remarks.set(reviewId, [...(this.remarks.get(reviewId) ?? []), ...added]);
    return this.write(reviewId, REMARKS_FILE);
  }

  /** Records that [session] received [ids] of the Review, and writes it. */
  delivered(reviewId: ReviewId, ids: readonly string[], session: SessionId): Promise<void> {
    for (const remark of this.remarks.get(reviewId) ?? []) {
      if (ids.includes(remark.id) && !remark.delivered_to.includes(session)) remark.delivered_to.push(session);
    }
    return this.write(reviewId, REMARKS_FILE);
  }

  /** Appends [notice] to its Review's notices and writes them. */
  addNotice(notice: StoredNotice): Promise<void> {
    this.notices.set(notice.review_id, [...(this.notices.get(notice.review_id) ?? []), notice]);
    return this.write(notice.review_id, NOTICES_FILE);
  }

  /**
   * Acknowledges the notice [id] of any Review so no later subscription replays it:
   * `unknown` when no notice has that id, `unchanged` when it was acknowledged before.
   */
  async acknowledge(id: string, at: IsoTime): Promise<"acknowledged" | "unchanged" | "unknown"> {
    for (const [reviewId, notices] of this.notices) {
      const notice = notices.find((entry) => entry.id === id);
      if (!notice) continue;
      if (notice.status === "acknowledged") return "unchanged";
      notice.status = "acknowledged";
      notice.acknowledged_at = at;
      await this.write(reviewId, NOTICES_FILE);
      return "acknowledged";
    }
    return "unknown";
  }

  /** Waits for every write started so far. */
  async settled(): Promise<void> {
    await Promise.all(this.writes.values());
  }

  private write(reviewId: ReviewId, file: typeof REMARKS_FILE | typeof NOTICES_FILE): Promise<void> {
    const key = `${reviewId}/${file}`;
    const previous = this.writes.get(key) ?? Promise.resolve();
    const next = previous.then(async () => {
      const folder = this.folder(reviewId);
      await mkdir(folder, { recursive: true });
      const temporary = join(folder, `.${file}.${randomBytes(6).toString("hex")}.tmp`);
      const content =
        file === REMARKS_FILE ? { remarks: this.remarks.get(reviewId) ?? [] } : { notices: this.notices.get(reviewId) ?? [] };
      await writeFile(temporary, `${JSON.stringify(content, null, 2)}\n`);
      await rename(temporary, join(folder, file));
    });
    // A failed write must not stop the next one; the caller of this one sees the failure.
    this.writes.set(key, next.catch(() => {}));
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

/**
 * The [key] list of the JSON file at [path], each entry parsed: undefined when there
 * is no file; a file that cannot be read or holds an entry that does not parse is
 * logged and read as none.
 */
async function readList<T>(
  path: string,
  key: string,
  parse: (value: unknown) => T | undefined,
  log: (line: string) => void,
): Promise<T[] | undefined> {
  // null: no file; undefined: a file that cannot be read.
  const content = await readFile(path, "utf8").catch((cause: unknown) => (field(cause, "code") === "ENOENT" ? null : undefined));
  if (content === null) return undefined;
  let data: unknown;
  try {
    data = content === undefined ? undefined : JSON.parse(content);
  } catch {
    data = undefined;
  }
  const entries = field(data, key);
  const parsed = Array.isArray(entries) ? entries.map(parse) : [undefined];
  if (parsed.some((entry) => entry === undefined)) {
    log(`skipped unreadable ${path}`);
    return undefined;
  }
  return parsed.filter((entry): entry is T => entry !== undefined);
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
  if (typeof id !== "string" || !REMARK_ID.test(id)) return undefined;
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

function parseNotice(value: unknown, reviewId: ReviewId): StoredNotice | undefined {
  const type = field(value, "type");
  const id = field(value, "id");
  const round = field(value, "round");
  const at = field(value, "at");
  const status = field(value, "status");
  const acknowledgedAt = field(value, "acknowledged_at");
  const notes = field(value, "notes");
  if (typeof id !== "string" || !NOTICE_ID.test(id)) return undefined;
  if (field(value, "review_id") !== reviewId || typeof round !== "number" || typeof at !== "string") return undefined;
  if (status !== "pending" && status !== "acknowledged") return undefined;
  if (acknowledgedAt !== undefined && typeof acknowledgedAt !== "string") return undefined;
  const kept: Omit<StoredNotice, "type" | "notes"> = {
    id,
    review_id: reviewId,
    round,
    at,
    status,
    ...(acknowledgedAt === undefined ? {} : { acknowledged_at: acknowledgedAt }),
  };
  if (type === "finish" && typeof notes === "string") {
    return { type, ...kept, notes, ...(field(value, "dismissed") === true ? { dismissed: true } : {}) };
  }
  if (type === "cancel") return { type, ...kept };
  return undefined;
}
