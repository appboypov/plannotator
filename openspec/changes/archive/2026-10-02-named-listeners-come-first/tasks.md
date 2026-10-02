## 1. Review API contract

- [x] 1.1 `packages/shared/review-api/types.ts` -- drop `PageOpenEvent` and `ListenerEvent` from `ListenServerMessage`; document `Review.listeners` in line order -- the socket no longer sends either frame
- [x] 1.2 `packages/shared/review-api/version.ts` -- `API_VERSION` 1.1 -- retiring read-only frames is a minor (ADR 0008)

## 2. Listen socket

- [x] 2.1 `packages/server/review-service/listen.ts` -- per-socket place in line (`named`, `all`), line and holder per Review, Remarks and notices to the holder only, hand-over through one holder diff on subscribe, socket open and close; remove `announce` and `pageOpened`; `subscribers` in line order -- one listener holds each Review
- [x] 2.2 `packages/server/review-service/service.ts` -- a page load records `last_page_open` without notifying listeners -- no `page_open` frame

## 3. Tests

- [x] 3.1 `packages/server/review-service/listen.test.ts` -- cover the delta scenarios: line order, holder-only delivery of Remarks and notices, hand-over on close, empty subscription, heartbeat drop and naming listener, replay of held Reviews only, no retired frames, `listeners` order; replace the tests that pin `listener` and `page_open`
- [x] 3.2 `packages/server/review-service/service.test.ts` -- version and health answer 1.1

## 4. Docs and ADR

- [x] 4.1 `docs/review-api.md` -- Version, Health, List Reviews, Listen to Reviews (line, holder, hand-over, replay), Liveness -- the contract's prose
- [x] 4.2 `docs/invariants.md` -- replay and delivery rule per holder
- [x] 4.3 `fork/README.md` -- Review API summary: version 1.1, one holder per Review
- [x] 4.4 `adr/0008-one-listener-holds-each-review.md` -- the one-holder rule and the minor-version refinement of ADR 0004

## 5. Verification

- [x] 5.1 `bun run typecheck` -- exits 0
- [x] 5.2 `bun test packages/server/review-service packages/shared/review-api apps/hook/server` -- all pass
- [ ] 5.3 `crabbox job run check` (local fallback `bun fork/ci-check.ts`) -- passes
- [x] 5.4 Live smoke on a free port with a temporary data dir: chat on `all` and an agent naming Review A; a Remark reaches only the agent, after the agent closes the chat session gets it -- observed
- [x] 5.5 `openspec validate named-listeners-come-first --type change --strict` -- valid

## Implementation Notes

Route oneshot: the production code is one module (`listen.ts`, about 80 changed lines) plus one-line edits in `service.ts`, `types.ts` and `version.ts`; the rest is tests and docs, built in one pass by the developer.

- `apps/hook/server/annotate-service.test.ts`: in the reconnect test a second socket under the call's session replaces the call's socket and takes the Remark. The call reconnects under a new session id, which now joins the Review's line behind that socket, so the test closes it once it received the Remark; the call then holds the Review and is handed the open Remark its new session never received, which is what the test checks. The behaviour under test (no Remark lost across a reconnect) is unchanged.
- The heartbeat test uses a raw TCP WebSocket client (`silentListener`), since Bun's client answers pings on its own.
- 5.4 smoke: `bun apps/hook/server/index.ts serve --port 4687` with `PLANNOTATOR_DATA_DIR` and `PLANNOTATOR_REVIEWS_DIR` under `/tmp/nlcf-smoke`, door ports off. Observed: `listeners` `["agent", "chat"]`, agent frames `subscribed, feedback_item`, chat frames `subscribed` only, `last_page_open` set by the page load; after the agent closed, chat got `feedback_item` "One.".
- 5.3: `crabbox job run check` was refused because the VPS lease is claimed by another repo (`/Users/codaveto/Repos/Clients/ivga/amd`); it was not reclaimed, so the local fallback `bun fork/ci-check.ts` ran: steps 1 to 6 passed, step 7 (Run tests) ran 7094 tests across 613 files with 5784 pass and 5 fail, so the check exits 1 and 5.3 stays open. All 5 failures reproduce on `main` (eaa0a0df) in a temporary worktree and lie outside this change: `scripts/dom-test-allowlist.test.ts` (`packages/ui/components/SentRemarks.test.tsx` from b9a44f4c is in no DOM_TESTS step), `packages/shared/review-core.test.ts` (missing index blob), and three in `apps/pi-extension/server/network.test.ts` (port selection listener counts). Every test under 5.2's folders passed in that run.

## Plan Change Log

- 2026-10-02: planned and approved in the same run (Brian: "build it all in one run").

## Review Triage Log

- codex review (`gpt-6.1-sol`, reasoning high, `--base main`): no findings ("No actionable defects found"), so no second review ran.
- Backlog: the 5 test failures `bun fork/ci-check.ts` shows on `main` as well (see 5.3), proposed in `~/Brainspace/proposals/das/named-listeners-come-first/main-check-failures.md`.
