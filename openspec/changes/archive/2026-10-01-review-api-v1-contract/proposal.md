## Why

The fork's always-on review service (epic `epic-plannotator-service`, story 2) needs one written contract before the service, the page, the CLI and the omp plugin are built against it in parallel. Brian wants a plugin copied from `omp-lavish-review` to work the same way against Plannotator, so the contract must be Lavish's review API v1, not a new one.

Owning intent: `/Users/codaveto/Brainspace/intents/das/own-plannotator-at-gates/own-plannotator-at-gates.md`. Story: `/Users/codaveto/Brainspace/intents/das/own-plannotator-at-gates/epic-plannotator-service/discovery.md#2`. Approach Part 2 (versioned review API and listen socket, paths under `/plannotator/`) and Part 4 (`temporary` Visibility).

Pressure test (madspec-grilling, answered from the approach, yolo run): "Is a contract without a server useful?" Yes: the stub answers every route so story 1.3 and epic 2 start at once. "Why keep Lavish's wire names (`feedback_item`, `fi_`) when Plannotator says Remark?" A renamed wire would need a changed plugin parser; the words map in the types and docs instead. "Why is the version route unversioned?" The plugin must read any major to refuse a different one (decision 2026-09-30 in the epic's Change Log).

## What Changes

- A fork-owned module `packages/shared/review-api/` (`@plannotator/shared/review-api`) with the v1 types (Review, Round, Remark, Reply, Visibility, every request, response and listen-socket message), `API_VERSION` (major 1, minor 0), route paths, ports, link building, and request and message parsers with the contract's error texts.
- `docs/review-api.md`: the prose contract, every route with its request and response type.
- A Bun stub server `packages/server/review-api/stub.ts` answering every route and the listen socket with contract-valid placeholder data.
- `adr/0004-review-api-v1-matches-lavish.md`.
- One export line in `packages/shared/package.json` (the only upstream file touched).

## Capabilities

### New Capabilities

- `review-api`: the review API v1 contract: version discovery, the Review routes, the listen socket's messages, Visibility and links, and the stub that answers them.

### Modified Capabilities

None.

## Impact

- New files only, plus one line in `packages/shared/package.json` exports.
- No runtime change to `plannotator` itself: the stub is a separate script. Story 1.3 (`plannotator serve`) implements the contract and replaces the stub.
- Consumers: stories 1.3 to 1.11, epic 2 (`omp-plannotator-review`), story 1.7 (CLI through the service).
