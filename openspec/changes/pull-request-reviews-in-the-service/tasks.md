## 1. Subjects and API

- [x] 1.1 Accept, canonicalize, persist and list PR URL subjects.

## 2. PR pages and decisions

- [x] 2.1 Start one upstream PR review page per Round with auth and fetch.
- [x] 2.2 Install page-base and Round closure glue in the code review entry.
- [x] 2.3 Map code annotations, Approve and Close with Round checks and draft clearing.
- [x] 2.4 Allow PR read routes through doors and strip local paths.

## 3. CLI

- [x] 3.1 Generalize annotate transport and route plain PR review calls through it.

## 4. Documentation and proof

- [x] 4.1 Document subjects, decisions, doors and CLI; record ADR 0009.
- [x] 4.2 Cover URL subjects, mapping, routing, doors and CLI with focused tests.
- [x] 4.3 Run focused tests, fork check and isolated real-PR smoke.

## 5. PR links that no public input gives

- [x] 5.1 `packages/server/review-service/store.ts` -- add `ReviewStore.find(subject)` -- a PR Review's id must not follow from its URL, so open finds Reviews by subject.
- [x] 5.2 `packages/server/review-service/service.ts` -- open finds the Review by canonical subject and gives a new PR Review a random id -- the door link's secret part.
- [x] 5.3 `packages/server/review-service/pr-reviews.test.ts` -- a door test refuses page, read, Remark, Approve and Close under the URL-hashed id; the id survives a restart.
- [x] 5.4 `adr/0009-one-upstream-review-server-per-pr-review.md`, `docs/invariants.md`, `docs/review-api.md` -- record that a PR Review's id is random and secret.
- [x] 5.5 Run `bun test packages/server/review-service/pr-reviews.test.ts`: all pass, the door test included.

## 6. A door reads only the diff's files

- [x] 6.1 `packages/server/review-service/pages.ts`, `apps/hook/server/serve-command.ts` -- a PR page carries the patch it serves -- the service checks door reads against the Round's patch without asking GitHub.
- [x] 6.2 `packages/server/review-service/door-manifest.ts`, `packages/server/review-service/service.ts` -- a door's `api/file-content` whose `path` or `oldPath` is not a file of that patch answers 404 before it reaches the page server -- any other path would read the repository with the provider token.
- [x] 6.3 `packages/server/review-service/pr-reviews.test.ts` -- a door test: a diff file loads, `.env.production` and a foreign `oldPath` answer 404 and never reach the page server.
- [x] 6.4 `docs/review-api.md`, `docs/invariants.md` -- record that door file expansion reads only the diff's files.
- [x] 6.5 Run `bun test packages/server/review-service/pr-reviews.test.ts`: all pass, the door test included.

## 7. A PR Round shows its current head

- [x] 7.1 `packages/server/review-service/pages.ts`, `apps/hook/server/serve-command.ts` -- a PR page remembers the head it fetched and can tell whether the PR's head moved since -- the service learns a moved head without a page restart.
- [x] 7.2 `packages/server/review-service/service.ts` -- opening a PR Review whose open Round's page shows a moved head cancels that Round and starts the next; a head that cannot be read answers 502 and keeps the Round -- an Approve passes only the head the reviewer saw.
- [x] 7.3 `packages/server/review-service/pr-reviews.test.ts` -- an open with the same head keeps Round 1; after the head moves an open starts Round 2, the old Round's Approve answers 409 and the page serves the new head.
- [x] 7.4 `docs/review-api.md`, `docs/invariants.md` -- record that a moved head starts the next Round.
- [x] 7.5 `packages/server/review-service/store.ts`, `service.ts`, `pr-reviews.test.ts` -- the Round's first PR page writes its head to `review.json` as `round_head`, and an open with no running page starts one to compare; tests cover a head that moved while the service was down and a head that cannot be read -- a restart cannot hide a moved head.
- [x] 7.5 Run `bun test packages/server/review-service/pr-reviews.test.ts`: all pass, the moved-head test included.

## Implementation Notes

The service reuses the upstream PR parser, review server, embedded HTML and review output formatter.

The code review surface fixes its decision destination to the service listener and omits provider destination controls under a session path. The PR context stream is a door read because the rendered page loads context through SSE.

Verification uses Bun 1.3.14, the runtime pinned by the upstream workflow. The focused contract tests pass. The fork check reaches its test step with 5810 passing tests, 1305 skipped tests and the opencode-plugin directory-selection timeout that also occurs on main. The remaining fork steps pass when run separately. The isolated service opens PR 22 as Review `14083d67dcb8ca66`, serves its code review page and diff, delivers a code Remark and finishes on browser Approve. The CLI reopens Round 2 and prints an approved JSON result with notes. The smoke service and listener are stopped.
