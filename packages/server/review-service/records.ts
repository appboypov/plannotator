/**
 * What a Review's listeners hear and its page shows, stored in the Review's folder so
 * it waits for them across sessions and restarts:
 * - Remarks (`remarks.json`): each annotation the reviewer sends with Send feedback.
 *   A Remark stays open until a Reply answers it and reaches each listener session
 *   once: the sessions it was delivered to are stored with it.
 * - Notices (`notices.json`): the Finish or Cancel that closed a Round, pending until
 *   any listener acknowledges it.
 * - Replies (`replies.json`): each agent's answer, shown on the page beside the
 *   Remarks it names; naming a Remark marks it answered.
 */
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  IsoTime,
  Notice,
  OpenRemark,
  Remark,
  RemarkAnchor,
  RemarkEvent,
  RemarkId,
  RemarkStatus,
  Reply,
  ReviewId,
  ReviewRepliesResponse,
  SessionId,
} from "@plannotator/shared/review-api";

/** A Review's Remarks file inside its own folder. */
export const REMARKS_FILE = "remarks.json";

/** A Review's notices file inside its own folder. */
export const NOTICES_FILE = "notices.json";

/** A Review's Replies file inside its own folder. */
export const REPLIES_FILE = "replies.json";

type RecordFile = typeof REMARKS_FILE | typeof NOTICES_FILE | typeof REPLIES_FILE;

/** What the service keeps per Remark: the Remark, when it was stored, and who has it. */
export type StoredRemark = Remark & {
  at: IsoTime;
  status: RemarkStatus;
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
const REPLY_ID = /^rp_[0-9a-f]{24}$/;

/** A new record id: [prefix], an underscore and 24 lowercase hex characters. */
export function recordId(prefix: "fi" | "nt" | "rp"): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

/**
 * The Remarks of one Send feedback: one per entry of the page's `annotations`, in
 * order, each carrying the page's formatted `feedback` text when it has one. A send
 * with that text but no annotations (only question answers, images or code
 * annotations) is one `global_comment` Remark whose words are the text, so it is not
 * lost. The draft generation is not a Remark.
 */
export function remarksFromFeedback(
  body: unknown,
  review: { review_id: ReviewId; round: number },
  at: IsoTime,
): StoredRemark[] {
  const annotations = field(body, "annotations");
  const feedback = text(field(body, "feedback"));
  const sent = feedback.trim() ? { feedback } : {};
  const remark = (words: string, anchor: RemarkAnchor): StoredRemark => ({
    id: recordId("fi"),
    review_id: review.review_id,
    round: review.round,
    text: words,
    anchor,
    ...sent,
    at,
    status: "open",
    delivered_to: [],
  });
  if (!Array.isArray(annotations) || annotations.length === 0) {
    return "feedback" in sent ? [remark(feedback, { selector: "", tag: "global_comment", text: "" })] : [];
  }
  return annotations.map((annotation: unknown) =>
    remark(text(field(annotation, "text")), {
      selector: text(field(annotation, "blockId")),
      tag: text(field(annotation, "type")).toLowerCase(),
      text: text(field(annotation, "originalText")),
    }),
  );
}

/** [remark] as the listen socket's frame. */
export function remarkEvent(remark: StoredRemark): RemarkEvent {
  const { id, review_id, round, text, anchor, feedback } = remark;
  return { type: "feedback_item", id, review_id, round, text, anchor, ...(feedback === undefined ? {} : { feedback }) };
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
 * Every Review's Remarks, notices and Replies, in memory and in each Review's folder.
 * Changes apply in memory at once, so a delivery decided right after sees them; each
 * file is then rewritten atomically, one write after another.
 */
export class ReviewRecords {
  private readonly writes = new Map<string, Promise<void>>();

  private constructor(
    private readonly folder: (reviewId: ReviewId) => string,
    private readonly remarks: Map<ReviewId, StoredRemark[]>,
    private readonly notices: Map<ReviewId, StoredNotice[]>,
    private readonly replies: Map<ReviewId, Reply[]>,
  ) {}

  /** Reads the records of [reviewIds]; a missing file is none, an unreadable one is logged and kept. */
  static async load(
    reviewIds: readonly ReviewId[],
    folder: (reviewId: ReviewId) => string,
    log: (line: string) => void,
  ): Promise<ReviewRecords> {
    const remarks = new Map<ReviewId, StoredRemark[]>();
    const notices = new Map<ReviewId, StoredNotice[]>();
    const replies = new Map<ReviewId, Reply[]>();
    for (const reviewId of reviewIds) {
      const dir = folder(reviewId);
      const storedRemarks = await readList(join(dir, REMARKS_FILE), "remarks", (value) => parseRemark(value, reviewId), log);
      if (storedRemarks) remarks.set(reviewId, storedRemarks);
      const storedNotices = await readList(join(dir, NOTICES_FILE), "notices", (value) => parseNotice(value, reviewId), log);
      if (storedNotices) notices.set(reviewId, storedNotices);
      const storedReplies = await readList(join(dir, REPLIES_FILE), "replies", (value) => parseReply(value, reviewId), log);
      if (storedReplies) replies.set(reviewId, storedReplies);
      // `addReply` writes the Replies before the Remarks; a stop between the two
      // leaves a stored Reply whose Remarks still read open. The Replies win.
      const answered = new Set((storedReplies ?? []).flatMap((reply) => reply.answers));
      for (const remark of storedRemarks ?? []) if (answered.has(remark.id)) remark.status = "answered";
    }
    return new ReviewRecords(folder, remarks, notices, replies);
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

  /** The ids among [ids] that are not Remarks of the Review, in the order named. */
  unknownRemarks(reviewId: ReviewId, ids: readonly RemarkId[]): RemarkId[] {
    const known = new Set((this.remarks.get(reviewId) ?? []).map((remark) => remark.id));
    return ids.filter((id) => !known.has(id));
  }

  /**
   * Appends [reply] to its Review's Replies and marks each Remark it answers
   * `answered`, so no later subscription replays it. Writes the Replies first, then
   * the Remarks: a stop between them is repaired on load, where stored Replies mark
   * their Remarks answered. The caller checked that every answered id is a Remark of
   * the Review.
   */
  async addReply(reply: Reply): Promise<void> {
    this.replies.set(reply.review_id, [...(this.replies.get(reply.review_id) ?? []), reply]);
    for (const remark of this.remarks.get(reply.review_id) ?? []) {
      if (reply.answers.includes(remark.id)) remark.status = "answered";
    }
    await this.write(reply.review_id, REPLIES_FILE);
    if (reply.answers.length > 0) await this.write(reply.review_id, REMARKS_FILE);
  }

  /** What the Review's page shows: every Remark with the Replies that answer it, then the Replies that answer none. */
  page(reviewId: ReviewId): ReviewRepliesResponse {
    const replies = this.replies.get(reviewId) ?? [];
    return {
      review_id: reviewId,
      remarks: (this.remarks.get(reviewId) ?? []).map((remark) => {
        const { delivered_to: _deliveredTo, ...shown } = remark;
        return { ...shown, replies: replies.filter((reply) => reply.answers.includes(remark.id)) };
      }),
      replies: replies.filter((reply) => reply.answers.length === 0),
    };
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

  private write(reviewId: ReviewId, file: RecordFile): Promise<void> {
    const key = `${reviewId}/${file}`;
    const previous = this.writes.get(key) ?? Promise.resolve();
    const next = previous.then(async () => {
      const folder = this.folder(reviewId);
      await mkdir(folder, { recursive: true });
      const temporary = join(folder, `.${file}.${randomBytes(6).toString("hex")}.tmp`);
      const content =
        file === REMARKS_FILE
          ? { remarks: this.remarks.get(reviewId) ?? [] }
          : file === NOTICES_FILE
            ? { notices: this.notices.get(reviewId) ?? [] }
            : { replies: this.replies.get(reviewId) ?? [] };
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
  const feedback = field(value, "feedback");
  return {
    id,
    review_id: reviewId,
    round,
    text: remarkText,
    anchor: { selector, tag, text: excerpt },
    ...(typeof feedback === "string" ? { feedback } : {}),
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

function parseReply(value: unknown, reviewId: ReviewId): Reply | undefined {
  const id = field(value, "id");
  const replyText = field(value, "text");
  const answers = field(value, "answers");
  const at = field(value, "at");
  if (typeof id !== "string" || !REPLY_ID.test(id)) return undefined;
  if (field(value, "review_id") !== reviewId || typeof replyText !== "string" || typeof at !== "string") return undefined;
  if (!Array.isArray(answers) || !answers.every((answer) => typeof answer === "string")) return undefined;
  return { id, review_id: reviewId, text: replyText, answers, at };
}
