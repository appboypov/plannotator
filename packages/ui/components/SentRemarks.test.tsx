/**
 * The panel's sent section (DOM-gated): with a source installed the panel lists each
 * sent annotation read-only with its replies indented under it; without one it adds
 * nothing.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AnnotationType, type Annotation } from '../types';
import { setSentRemarksSource, type SentRemark } from './SentRemarks';

// The panel needs a DOM at import time, so it loads only when the DOM preload ran.
const hasDom = typeof document !== 'undefined';
const panelModule = hasDom ? await import('./AnnotationPanel') : null;
const AnnotationPanel = panelModule?.AnnotationPanel as NonNullable<typeof panelModule>['AnnotationPanel'];

function ann(id: string, extra: Partial<Annotation> = {}): Annotation {
  return { id, blockId: 'blk', startOffset: 0, endOffset: 0, type: AnnotationType.COMMENT, text: `text ${id}`, originalText: 'abc', createdA: 1, ...extra };
}

let root: Root | null = null;
let host: HTMLElement | null = null;

async function render(draft: Annotation[] = []) {
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host!);
    root.render(<AnnotationPanel isOpen annotations={draft} blocks={[]} onSelect={() => {}} onDelete={() => {}} selectedId={null} />);
  });
  return host;
}

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  host?.remove();
  root = null;
  host = null;
  setSentRemarksSource(null);
});

describe.skipIf(!hasDom)('AnnotationPanel sent annotations', () => {
  test('a sent annotation shows read-only with its reply indented under it, after the draft', async () => {
    const sent: SentRemark[] = [
      { annotation: ann('fi_1'), stamp: 'Round 1', replies: [ann('rp_1:fi_1', { type: AnnotationType.GLOBAL_COMMENT, text: 'Fixed it.', author: 'Agent', inReplyTo: 'fi_1' })] },
      { annotation: null, replies: [ann('rp_2', { type: AnnotationType.GLOBAL_COMMENT, text: 'General note.', author: 'Agent' })] },
    ];
    setSentRemarksSource(async () => sent);
    const el = await render([ann('draft')]);

    const ids = [...el.querySelectorAll('[data-annotation-id]')].map((n) => n.getAttribute('data-annotation-id'));
    expect(ids).toEqual(['draft', 'fi_1', 'rp_1:fi_1', 'rp_2']);
    const section = el.querySelector('[data-sent-remarks="true"]')!;
    expect(section.textContent).toContain('Round 1');
    const reply = section.querySelector('[data-annotation-reply="true"]');
    expect(reply?.querySelector('[data-annotation-id="rp_1:fi_1"]')?.textContent).toContain('Reply');
    expect(reply?.textContent).toContain('Fixed it.');
    expect(section.querySelectorAll('[data-annotation-reply="true"]').length).toBe(1);
    expect(section.querySelector('[title="Delete annotation"]')).toBeNull();
    expect(el.querySelector('[data-annotation-id="draft"] [title="Delete annotation"]')).not.toBeNull();
  });

  test('without a source the panel adds no sent section', async () => {
    const el = await render([ann('draft')]);
    expect(el.querySelector('[data-sent-remarks="true"]')).toBeNull();
  });
});
