/**
 * A Review page shows the Remarks the reviewer sent and the agents' Replies to them.
 * This module reads them from the service (`<base>api/review-replies`) for the page's
 * own Review. It keeps every well-formed Remark and Reply and drops malformed ones, so
 * one bad record cannot hide the rest.
 */
import { reviewPageBase } from "./page-base.ts";
import { PAGE_REPLIES_PATH } from "./routes.ts";
import type { PageRemark, Reply, ReviewRepliesResponse } from "./types.ts";

/**
 * The Remarks and Replies of the Review the page at [pathname] shows, or null when the
 * page does not live under a session path. Throws when the service does not answer
 * HTTP 200 with a Review's Remarks.
 */
export async function loadPageReplies(
  fetch: (input: string) => Promise<Response>,
  pathname: string,
): Promise<ReviewRepliesResponse | null> {
  const base = reviewPageBase(pathname);
  if (base === null) return null;
  const response = await fetch(`${base}${PAGE_REPLIES_PATH}`);
  if (!response.ok) throw new Error(`${PAGE_REPLIES_PATH} answered HTTP ${response.status}`);
  const replies = parsePageReplies(await response.json());
  if (!replies) throw new Error(`${PAGE_REPLIES_PATH} answered no Remarks`);
  return replies;
}

/** [data] as a page's Remarks and Replies; undefined unless it names a Review and both lists. */
export function parsePageReplies(data: unknown): ReviewRepliesResponse | undefined {
  if (!isObject(data) || typeof data.review_id !== "string") return undefined;
  if (!Array.isArray(data.remarks) || !Array.isArray(data.replies)) return undefined;
  return {
    review_id: data.review_id,
    remarks: data.remarks.flatMap((value) => {
      const remark = parseRemark(value);
      return remark ? [remark] : [];
    }),
    replies: parseReplies(data.replies),
  };
}

function parseRemark(value: unknown): PageRemark | undefined {
  if (!isObject(value) || !isObject(value.anchor) || !Array.isArray(value.replies)) return undefined;
  const { id, review_id, round, text, at, status } = value;
  const { selector, tag, text: excerpt } = value.anchor;
  if (typeof id !== "string" || typeof review_id !== "string" || typeof round !== "number") return undefined;
  if (typeof text !== "string" || typeof at !== "string") return undefined;
  if (status !== "open" && status !== "answered") return undefined;
  if (typeof selector !== "string" || typeof tag !== "string" || typeof excerpt !== "string") return undefined;
  return {
    id,
    review_id,
    round,
    text,
    anchor: { selector, tag, text: excerpt },
    at,
    status,
    replies: parseReplies(value.replies),
  };
}

function parseReplies(values: unknown[]): Reply[] {
  return values.flatMap((value): Reply[] => {
    if (!isObject(value)) return [];
    const { id, review_id, text, answers, at } = value;
    if (typeof id !== "string" || typeof review_id !== "string" || typeof text !== "string") return [];
    if (typeof at !== "string" || !Array.isArray(answers)) return [];
    if (!answers.every((answer) => typeof answer === "string")) return [];
    return [{ id, review_id, text, answers, at }];
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
