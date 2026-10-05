import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { ReviewRecords, StoredNotice, StoredRemark } from "./records.ts";

function withoutMentions(value: string): string {
  return value.replaceAll("mention://", "mention:\\/\\/");
}

function codeSpan(value: string): string {
  const text = withoutMentions(value).replace(/[\r\n]+/g, " ");
  let longest = 0;
  for (const run of text.matchAll(/`+/g)) longest = Math.max(longest, run[0].length);
  const fence = "`".repeat(longest + 1);
  const pad = /^[` ]|[` ]$/.test(text) ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

/** The member's top-level comment: reviewer text is quoted and cannot mention an agent. */
export function buildMulticaComment(review: { file: string; link: string }, record: StoredRemark | StoredNotice): string {
  const name = basename(review.file).replace(/[\\[\]]/g, "\\$&");
  const link = `[${name}](${review.link})`;
  const id = codeSpan(record.id);
  const reviewId = codeSpan(record.review_id);
  if ("type" in record) {
    const title = record.type === "finish" && record.dismissed
      ? `**Closed** round ${record.round} of ${link} without approving.`
      : `**Approved** round ${record.round} of ${link}.`;
    const notes = record.type === "finish" && record.notes
      ? `\n\n${withoutMentions(record.notes).split(/\r?\n/).map((line) => `> ${line}`).join("\n")}` : "";
    return `${title}${notes}\n\n- Notice: ${id}\n- Review: ${reviewId}`;
  }
  const quote = record.text
    ? `${withoutMentions(record.text).split(/\r?\n/).map((line) => `> ${line}`).join("\n")}\n\n` : "";
  const { tag, selector, text } = record.anchor;
  const anchor = tag || selector || text
    ? `${codeSpan(tag)} ${codeSpan(selector)}: "${withoutMentions(text).replace(/\s+/g, " ").trim()}"`
    : "the whole page";
  return `**Remark** on ${link}, round ${record.round}:\n\n${quote}- Item: ${id}\n- On: ${anchor}\n- Review: ${reviewId}\n\nAnswer with \`plannotator_reply\` on Review ${reviewId} with answers [${id}].`;
}

const FIRST_RETRY_MS = 1000;
const MAX_RETRY_MS = 5 * 60_000;
const POST_TIMEOUT_MS = 15_000;

type Lane = {
  running: Promise<void> | null;
  timer: NodeJS.Timeout | undefined;
  delay: number;
  generation: number;
  relinkGeneration: number;
};

/** One independent, store-ordered delivery lane per Review, with no credentials in state or logs. */
export class MulticaPoster {
  private readonly lanes = new Map<string, Lane>();
  private readonly stopping = new AbortController();
  private closed = false;

  constructor(private readonly options: {
    records: ReviewRecords;
    profile: string | null;
    home?: string;
    reviewOf: (id: string) => { file: string; link: string } | undefined;
    log: (line: string) => void;
  }) {
    for (const id of options.records.reviewIds()) {
      if (options.records.pendingDeliveries(id).length > 0) this.wake(id);
    }
  }

  wake(reviewId: string, relink = false): void {
    if (this.closed) return;
    let lane = this.lanes.get(reviewId);
    if (!lane) {
      lane = { running: null, timer: undefined, delay: FIRST_RETRY_MS, generation: 0, relinkGeneration: 0 };
      this.lanes.set(reviewId, lane);
    }
    lane.generation += 1;
    if (relink) {
      lane.relinkGeneration += 1;
      clearTimeout(lane.timer);
      lane.timer = undefined;
      lane.delay = FIRST_RETRY_MS;
    }
    if (lane.running || lane.timer) return;
    const generation = lane.generation;
    const current = lane;
    current.running = this.drain(reviewId, current).finally(() => {
      current.running = null;
      if (!this.closed && !current.timer && generation !== current.generation) this.wake(reviewId);
    });
  }

  async stop(): Promise<void> {
    this.closed = true;
    this.stopping.abort();
    for (const lane of this.lanes.values()) clearTimeout(lane.timer);
    await Promise.all([...this.lanes.values()].map((lane) => lane.running));
  }

  private retryLater(reviewId: string, lane: Lane): void {
    lane.timer = setTimeout(() => {
      lane.timer = undefined;
      this.wake(reviewId);
    }, lane.delay);
    lane.timer.unref();
    lane.delay = Math.min(lane.delay * 2, MAX_RETRY_MS);
  }

  private async drain(reviewId: string, lane: Lane): Promise<void> {
    const { records, log } = this.options;
    while (!this.closed) {
      const pending = records.pendingDeliveries(reviewId)[0];
      if (!pending?.multica) return;
      const record = { ...pending, multica: { ...pending.multica } };
      const generation = lane.relinkGeneration;
      let status: number | string = "profile";
      const kind = "type" in record ? record.type : "feedback_item";
      try {
        await records.settled();
        const profileName = this.options.profile?.trim();
        if (!profileName) throw new Error("profile missing");
        const profile: unknown = JSON.parse(await readFile(
          join(this.options.home ?? homedir(), ".multica", "profiles", profileName, "config.json"), "utf8"));
        if (profile === null || typeof profile !== "object" || !("server_url" in profile) || !("token" in profile) ||
            typeof profile.server_url !== "string" || !profile.server_url || typeof profile.token !== "string" || !profile.token) {
          throw new Error("profile incomplete");
        }
        const review = this.options.reviewOf(reviewId);
        if (!review) throw new Error("review missing");
        if (this.closed) return;
        status = "network";
        const response = await fetch(
          `${profile.server_url.replace(/\/$/, "")}/api/issues/${encodeURIComponent(record.multica.issue)}/comments`, {
            method: "POST",
            headers: { authorization: `Bearer ${profile.token}`, "content-type": "application/json",
              "X-Workspace-ID": record.multica.workspace_id },
            body: JSON.stringify({ content: buildMulticaComment(review, record) }),
            signal: AbortSignal.any([this.stopping.signal, AbortSignal.timeout(POST_TIMEOUT_MS)]),
          });
        status = response.status;
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error("post refused");
        }
        const comment: unknown = await response.json();
        if (comment === null || typeof comment !== "object" || !("id" in comment) ||
            typeof comment.id !== "string" || !comment.id.trim()) throw new Error("comment id missing");
        await records.markPosted(record.id, comment.id, new Date().toISOString(), record.multica);
        lane.delay = FIRST_RETRY_MS;
        log(`multica posted review=${encodeURIComponent(reviewId)} id=${encodeURIComponent(record.id)} kind=${kind} status=${status}`);
      } catch {
        if (this.closed) return;
        log(`multica pending review=${encodeURIComponent(reviewId)} id=${encodeURIComponent(record.id)} kind=${kind} status=${status}`);
        if (generation !== lane.relinkGeneration) continue;
        this.retryLater(reviewId, lane);
        return;
      }
    }
  }
}
