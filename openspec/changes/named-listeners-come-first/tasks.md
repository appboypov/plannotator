## 1. Review API contract

- [ ] 1.1 `packages/shared/review-api/types.ts` -- drop `PageOpenEvent` and `ListenerEvent` from `ListenServerMessage`; document `Review.listeners` in line order -- the socket no longer sends either frame
- [ ] 1.2 `packages/shared/review-api/version.ts` -- `API_VERSION` 1.1 -- retiring read-only frames is a minor (ADR 0008)

## 2. Listen socket

- [ ] 2.1 `packages/server/review-service/listen.ts` -- per-socket place in line (`named`, `all`), line and holder per Review, Remarks and notices to the holder only, hand-over through one holder diff on subscribe, socket open and close; remove `announce` and `pageOpened`; `subscribers` in line order -- one listener holds each Review
- [ ] 2.2 `packages/server/review-service/service.ts` -- a page load records `last_page_open` without notifying listeners -- no `page_open` frame

## 3. Tests

- [ ] 3.1 `packages/server/review-service/listen.test.ts` -- cover the delta scenarios: line order, holder-only delivery of Remarks and notices, hand-over on close, empty subscription, heartbeat drop and naming listener, replay of held Reviews only, no retired frames, `listeners` order; replace the tests that pin `listener` and `page_open`
- [ ] 3.2 `packages/server/review-service/service.test.ts` -- version and health answer 1.1

## 4. Docs and ADR

- [ ] 4.1 `docs/review-api.md` -- Version, Health, List Reviews, Listen to Reviews (line, holder, hand-over, replay), Liveness -- the contract's prose
- [ ] 4.2 `docs/invariants.md` -- replay and delivery rule per holder
- [ ] 4.3 `fork/README.md` -- Review API summary: version 1.1, one holder per Review
- [ ] 4.4 `adr/0008-one-listener-holds-each-review.md` -- the one-holder rule and the minor-version refinement of ADR 0004

## 5. Verification

- [ ] 5.1 `bun run typecheck` -- exits 0
- [ ] 5.2 `bun test packages/server/review-service packages/shared/review-api apps/hook/server` -- all pass
- [ ] 5.3 `crabbox job run check` (local fallback `bun fork/ci-check.ts`) -- passes
- [ ] 5.4 Live smoke on a free port with a temporary data dir: chat on `all` and an agent naming Review A; a Remark reaches only the agent, after the agent closes the chat session gets it -- observed
- [ ] 5.5 `openspec validate named-listeners-come-first --type change --strict` -- valid

## Implementation Notes

Route oneshot: the production code is one module (`listen.ts`, about 80 changed lines) plus one-line edits in `service.ts`, `types.ts` and `version.ts`; the rest is tests and docs, built in one pass by the developer.

## Plan Change Log

- 2026-10-02: planned and approved in the same run (Brian: "build it all in one run").

## Review Triage Log
