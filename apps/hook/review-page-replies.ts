/**
 * Fork: a Review page's annotation panel lists the Remarks the reviewer sent, each with
 * the agents' Replies under it (see `@plannotator/shared/review-api/page-replies`). A
 * Reply answering several Remarks shows under each; Replies answering none follow last.
 */
import { loadPageReplies } from '@plannotator/shared/review-api/page-replies';
import type { PageRemark, Reply, ReviewRepliesResponse } from '@plannotator/shared/review-api';
import type { SentRemark } from '@plannotator/ui/components/SentRemarks';
import { AnnotationType, type Annotation } from '@plannotator/ui/types';

/** Who a Reply's card names as its author. */
export const REPLY_AUTHOR = 'Agent';

/** The panel's sent annotations of the page at [pathname], read through [fetch]. */
export async function loadSentRemarks(fetch: (input: string) => Promise<Response>, pathname: string): Promise<SentRemark[]> {
  const replies = await loadPageReplies(fetch, pathname);
  return replies ? sentRemarks(replies) : [];
}

/** The page's Remarks and Replies as the panel's sent annotations, in store order. */
export function sentRemarks({ remarks, replies }: ReviewRepliesResponse): SentRemark[] {
  const sent: SentRemark[] = remarks.map((remark) => ({
    annotation: remarkAnnotation(remark),
    stamp: `Round ${remark.round}`,
    replies: remark.replies.map((reply) => replyAnnotation(reply, remark.id)),
  }));
  if (replies.length > 0) sent.push({ annotation: null, replies: replies.map((reply) => replyAnnotation(reply, null)) });
  return sent;
}

const TYPES: Record<string, AnnotationType> = {
  comment: AnnotationType.COMMENT,
  deletion: AnnotationType.DELETION,
  global_comment: AnnotationType.GLOBAL_COMMENT,
};

function remarkAnnotation(remark: PageRemark): Annotation {
  return {
    id: remark.id,
    blockId: remark.anchor.selector,
    startOffset: 0,
    endOffset: 0,
    type: TYPES[remark.anchor.tag] ?? AnnotationType.COMMENT,
    text: remark.text,
    originalText: remark.anchor.text,
    createdA: Date.parse(remark.at),
  };
}

/** A Reply's card under [remarkId], or on its own when null; the id is unique per card. */
function replyAnnotation(reply: Reply, remarkId: string | null): Annotation {
  return {
    id: remarkId ? `${reply.id}:${remarkId}` : reply.id,
    blockId: '',
    startOffset: 0,
    endOffset: 0,
    type: AnnotationType.GLOBAL_COMMENT,
    text: reply.text,
    originalText: '',
    createdA: Date.parse(reply.at),
    author: REPLY_AUTHOR,
    ...(remarkId ? { inReplyTo: remarkId } : {}),
  };
}
