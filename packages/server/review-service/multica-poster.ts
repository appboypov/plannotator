import { basename } from "node:path";
import type { StoredNotice, StoredRemark } from "./records.ts";

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
