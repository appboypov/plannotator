import { describe, expect, test } from 'bun:test';
import type { PageRemark, Reply } from '@plannotator/shared/review-api';
import { AnnotationType } from '@plannotator/ui/types';
import { REPLY_AUTHOR, sentRemarks } from './review-page-replies';

const REVIEW = '0123456789abcdef';

function remark(id: string, round: number, tag: string, replies: Reply[] = []): PageRemark {
  return {
    id,
    review_id: REVIEW,
    round,
    text: `remark ${id}`,
    anchor: { selector: `block-${id}`, tag, text: tag === 'global_comment' ? '' : `excerpt ${id}` },
    at: '2026-10-01T09:30:00.000Z',
    status: replies.length > 0 ? 'answered' : 'open',
    replies,
  };
}

function reply(id: string, answers: string[]): Reply {
  return { id, review_id: REVIEW, text: `reply ${id}`, answers, at: '2026-10-01T09:40:00.000Z' };
}

describe('sentRemarks', () => {
  test('each Remark keeps its kind and excerpt, stamped with its Round', () => {
    const [comment, deletion, global] = sentRemarks({
      review_id: REVIEW,
      remarks: [remark('fi_1', 1, 'comment'), remark('fi_2', 2, 'deletion'), remark('fi_3', 2, 'global_comment')],
      replies: [],
    });
    expect(comment.annotation).toMatchObject({ id: 'fi_1', type: AnnotationType.COMMENT, originalText: 'excerpt fi_1', text: 'remark fi_1', blockId: 'block-fi_1' });
    expect(comment.stamp).toBe('Round 1');
    expect(deletion.annotation?.type).toBe(AnnotationType.DELETION);
    expect(global.annotation?.type).toBe(AnnotationType.GLOBAL_COMMENT);
    expect(global.stamp).toBe('Round 2');
  });

  test('a Reply answering two Remarks shows under each with its own card id', () => {
    const both = reply('rp_1', ['fi_1', 'fi_2']);
    const sent = sentRemarks({
      review_id: REVIEW,
      remarks: [remark('fi_1', 1, 'comment', [both]), remark('fi_2', 1, 'comment', [both])],
      replies: [],
    });
    expect(sent.map((entry) => entry.replies.map((card) => [card.id, card.inReplyTo, card.author, card.text]))).toEqual([
      [['rp_1:fi_1', 'fi_1', REPLY_AUTHOR, 'reply rp_1']],
      [['rp_1:fi_2', 'fi_2', REPLY_AUTHOR, 'reply rp_1']],
    ]);
  });

  test('Replies answering no Remark follow last, on their own', () => {
    const sent = sentRemarks({ review_id: REVIEW, remarks: [remark('fi_1', 1, 'comment')], replies: [reply('rp_2', [])] });
    expect(sent).toHaveLength(2);
    expect(sent[1].annotation).toBeNull();
    expect(sent[1].replies[0]).toMatchObject({ id: 'rp_2', author: REPLY_AUTHOR });
    expect(sent[1].replies[0].inReplyTo).toBeUndefined();
  });

  test('a Review without Remarks or Replies shows nothing', () => {
    expect(sentRemarks({ review_id: REVIEW, remarks: [], replies: [] })).toEqual([]);
  });
});
