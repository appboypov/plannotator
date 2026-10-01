/**
 * Fork: the annotations the reviewer already sent, each with the replies it got, shown
 * read-only at the foot of the annotation panel. The host page installs where they come
 * from (`setSentRemarksSource`); without a source the panel shows nothing more. They load
 * when the panel opens, so a reload shows replies that arrived since.
 */
import React, { useEffect, useState } from 'react';
import type { Annotation } from '../types';

/** One sent annotation and the replies to it; `annotation` is null for replies that answer none. */
export interface SentRemark {
  annotation: Annotation | null;
  /** A short stamp in the card's header, such as the round it was sent in. */
  stamp?: string;
  replies: Annotation[];
}

/** Loads the sent annotations with their replies, in the order the panel lists them. */
export type SentRemarksSource = () => Promise<SentRemark[]>;

let sentRemarksSource: SentRemarksSource | null = null;

/** Installs where the panel's sent annotations come from; null removes it. */
export function setSentRemarksSource(source: SentRemarksSource | null): void {
  sentRemarksSource = source;
}

/** Draws one read-only card with the panel's own card, with an optional type label and header. */
export type SentCardRenderer = (annotation: Annotation, options: { label?: string; header?: React.ReactNode }) => React.ReactNode;

const REPLY_LABEL = 'Reply';

export const SentRemarks: React.FC<{ renderCard: SentCardRenderer }> = ({ renderCard }) => {
  const [remarks, setRemarks] = useState<SentRemark[]>([]);

  useEffect(() => {
    const source = sentRemarksSource;
    if (!source) return;
    let live = true;
    source().then(
      (loaded) => {
        if (live) setRemarks(loaded);
      },
      (error: unknown) => console.error('[plannotator] could not load sent annotations', error),
    );
    return () => {
      live = false;
    };
  }, []);

  if (remarks.length === 0) return null;

  return (
    <section data-sent-remarks="true" className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 pt-2 pb-1">
        <div className="flex-1 border-t border-border/30" />
        <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/60">Sent</span>
        <div className="flex-1 border-t border-border/30" />
      </div>
      {remarks.map((remark, index) => (
        <React.Fragment key={remark.annotation?.id ?? `replies-${index}`}>
          {remark.annotation &&
            renderCard(remark.annotation, {
              header: remark.stamp && (
                <span className="text-[9px] px-1.5 py-0.5 rounded font-medium bg-muted text-muted-foreground">
                  {remark.stamp}
                </span>
              ),
            })}
          {remark.replies.map((reply) =>
            remark.annotation ? (
              <div key={reply.id} data-annotation-reply="true" className="ml-3 border-l-2 border-border/40 pl-1.5">
                {renderCard(reply, { label: REPLY_LABEL })}
              </div>
            ) : (
              <React.Fragment key={reply.id}>{renderCard(reply, { label: REPLY_LABEL })}</React.Fragment>
            ),
          )}
        </React.Fragment>
      ))}
    </section>
  );
};
