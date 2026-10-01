/**
 * Fork: what a Review page shows once its Round is over for it (see
 * `@plannotator/shared/review-api/page-round`). A full-window cover over upstream's page
 * takes every click and key, so the page is closed for review; a later Round replaces an
 * ended Round's cover with one that offers a reload into it.
 */
import type { PageClosure } from '@plannotator/shared/review-api/page-round';
import type { EndedState } from '@plannotator/shared/review-api';

const COPY: Record<EndedState | 'next-round', (round: number) => { title: string; body: string }> = {
  cancelled: (round) => ({
    title: `Round ${round} was cancelled`,
    body: 'The agent cancelled this round, so the page is closed. It opens again when the agent asks for another review.',
  }),
  finished: (round) => ({
    title: `Round ${round} is finished`,
    body: 'This round ended, so the page is closed. It opens again when the agent asks for another review.',
  }),
  'next-round': (round) => ({
    title: `Round ${round} is open`,
    body: 'The document was sent for review again. Reload to review the new round.',
  }),
};

export function showReviewPageClosure(closure: PageClosure): void {
  const copy = COPY[closure.kind === 'ended' ? closure.state : closure.kind](closure.round);
  const cover = document.createElement('div');
  cover.setAttribute('role', 'alertdialog');
  cover.setAttribute('aria-modal', 'true');
  cover.setAttribute('aria-labelledby', 'review-page-closure-title');
  cover.dataset.reviewPageClosure = closure.kind === 'ended' ? closure.state : closure.kind;
  Object.assign(cover.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '2147483647',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(8, 10, 18, 0.92)',
    color: '#e6e8ef',
    font: '14px/1.5 system-ui, -apple-system, sans-serif',
  });

  const panel = document.createElement('div');
  Object.assign(panel.style, { maxWidth: '420px', padding: '24px', textAlign: 'center' });
  const title = document.createElement('h2');
  title.id = 'review-page-closure-title';
  title.textContent = copy.title;
  Object.assign(title.style, { margin: '0 0 8px', fontSize: '18px', fontWeight: '600' });
  const body = document.createElement('p');
  body.textContent = copy.body;
  Object.assign(body.style, { margin: '0', color: '#a3a8b8' });
  panel.append(title, body);

  if (closure.kind === 'next-round') {
    const reload = document.createElement('button');
    reload.type = 'button';
    reload.textContent = `Review round ${closure.round}`;
    Object.assign(reload.style, {
      marginTop: '16px',
      padding: '8px 16px',
      border: '0',
      borderRadius: '6px',
      background: '#6d5dfc',
      color: '#fff',
      font: 'inherit',
      cursor: 'pointer',
    });
    reload.addEventListener('click', () => window.location.reload());
    panel.append(reload);
  }

  cover.append(panel);
  // Keys stop at the document, so upstream's shortcuts cannot act on a closed page.
  document.addEventListener('keydown', stopKey, true);
  const earlier = document.querySelector('[data-review-page-closure]');
  if (earlier) earlier.replaceWith(cover);
  else document.body.append(cover);
  cover.tabIndex = -1;
  cover.focus();
}

/** One listener for every cover: adding the same function again is a no-op. */
function stopKey(event: KeyboardEvent): void {
  event.stopImmediatePropagation();
}
