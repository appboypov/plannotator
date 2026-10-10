import { afterEach, describe, expect, test } from 'bun:test';
import type {
  PRMetadata,
  PRReviewFileComment,
  PRReviewSubmissionResult,
} from '@plannotator/shared/pr-types';
import { createTestEnvironment } from '../../tests/helpers/environment';
import { startReviewServer } from './review';

const environment = createTestEnvironment(
  ['PLANNOTATOR_AI', 'PLANNOTATOR_DATA_DIR', 'PATH'],
  'plannotator-pr-action-',
);
const activeServers = new Set<{ stop: () => void }>();

const prMetadata: PRMetadata = {
  platform: 'gitlab',
  host: 'gitlab.invalid',
  projectPath: 'acme/widgets',
  iid: 7,
  title: 'Reliable comments',
  author: 'reviewer',
  baseBranch: 'main',
  headBranch: 'feature',
  baseSha: 'base',
  headSha: 'head',
  url: 'https://gitlab.invalid/acme/widgets/-/merge_requests/7',
};

const fileComment: PRReviewFileComment = {
  path: 'src/failing.ts',
  line: 19,
  side: 'RIGHT',
  body: 'Handle this failure.',
};

async function withReviewServer(
  submit: (...args: unknown[]) => Promise<PRReviewSubmissionResult>,
  run: (url: string) => Promise<void>,
): Promise<void> {
  environment.reset();
  process.env.PLANNOTATOR_AI = 'disabled';
  process.env.PLANNOTATOR_DATA_DIR = environment.makeTempDir();
  // An empty PATH: no platform CLI can run for the review session.
  process.env.PATH = environment.makeTempDir();
  const server = await startReviewServer({
    rawPatch: 'diff --git a/src/failing.ts b/src/failing.ts\n',
    gitRef: 'MR !7',
    htmlContent: '<!doctype html><html><body>review</body></html>',
    prMetadata,
    prReviewSubmitter: async (...args) => submit(...args),
  });
  activeServers.add(server);
  try {
    await run(server.url);
  } finally {
    server.stop();
    activeServers.delete(server);
  }
}

async function postReview(url: string): Promise<Response> {
  return fetch(`${url}/api/pr-action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'comment',
      body: 'Overall review',
      fileComments: [fileComment],
    }),
  });
}

// A session still running when its test ends stops before the environment it
// was started in is restored.
afterEach(() => {
  for (const server of activeServers) server.stop();
  activeServers.clear();
  environment.restore();
});

describe('Bun /api/pr-action submission contract', () => {
  test('returns complete success', async () => {
    await withReviewServer(
      async () => ({ status: 'complete' }),
      async (url) => {
        const response = await postReview(url);
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          ok: true,
          submission: { status: 'complete' },
        });
      },
    );
  });

  test('returns an all-failure as an error', async () => {
    await withReviewServer(
      async () => {
        throw new Error('Failed to post inline comments');
      },
      async (url) => {
        const response = await postReview(url);
        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({
          error: 'Failed to post inline comments',
        });
      },
    );
  });

  test('returns mixed outcomes as actionable partial success', async () => {
    const partial: PRReviewSubmissionResult = {
      status: 'partial',
      postedFileCommentCount: 1,
      failedFileComments: [{
        comment: fileComment,
        error: 'src/failing.ts:19: rejected',
      }],
      reviewBodyPosted: true,
      approval: 'not-requested',
      recoveryFile: '/tmp/failed-comments/review.json',
      retry: {
        action: 'comment',
        fileComments: [fileComment],
      },
    };
    await withReviewServer(
      async () => partial,
      async (url) => {
        const response = await postReview(url);
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          ok: true,
          prUrl: prMetadata.url,
          submission: partial,
        });
      },
    );
  });

  test('forwards well-formed file-level comments to the submitter (#1599)', async () => {
    let received: unknown;
    await withReviewServer(
      async (...args) => {
        received = args[5];
        return { status: 'complete' };
      },
      async (url) => {
        const response = await fetch(`${url}/api/pr-action`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'comment',
            body: 'Overall review',
            fileComments: [],
            fileLevelComments: [
              { path: 'src/failing.ts', body: 'Split this file.' },
              { path: '', body: 'no path' },
              { path: 'src/x.ts', body: '   ' },
              'garbage',
            ],
          }),
        });
        expect(response.status).toBe(200);
      },
    );
    expect(received).toEqual([{ path: 'src/failing.ts', body: 'Split this file.' }]);
  });

  // #1611: the review event reaches the submitter, and a malformed one is
  // refused instead of silently posting a neutral comment.
  test('passes request_changes through to the submitter', async () => {
    let received: unknown;
    await withReviewServer(
      async (...args) => {
        received = args[2];
        return { status: 'complete' };
      },
      async (url) => {
        const response = await fetch(`${url}/api/pr-action`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'request_changes', body: 'Please fix', fileComments: [fileComment] }),
        });
        expect(response.status).toBe(200);
      },
    );
    expect(received).toBe('request_changes');
  });

  test('refuses an unknown action with 400 and never submits', async () => {
    let calls = 0;
    await withReviewServer(
      async () => {
        calls += 1;
        return { status: 'complete' };
      },
      async (url) => {
        for (const action of ['REQUEST_CHANGES', 'reject', undefined]) {
          const response = await fetch(`${url}/api/pr-action`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, body: 'x', fileComments: [] }),
          });
          expect(response.status).toBe(400);
        }
      },
    );
    expect(calls).toBe(0);
  });
});
