## Why

Owning intent: `/Users/codaveto/Brainspace/intents/das/own-plannotator-at-gates/own-plannotator-at-gates.md`. Story: `/Users/codaveto/Brainspace/intents/das/own-plannotator-at-gates/epic-plannotator-service/discovery.md#6`.

A Review only stores Remarks so far: Approve on the page goes to the upstream page server and is lost, an agent cannot cancel, and opening the same file again never starts a new Round. The gates need the reviewer's Approve (with its notes) to reach the agent, a Cancel to close the page, the next Round to open on the same link, and the list to show how each Review stands.

Pressure test: what if the page Approves after the agent cancelled? The command is Round-checked and answers 409 `ended`; the page closes. What if two tabs show one Review and one approves? The other tab's Round stream reports `finished` and it closes. What if the agent reopens while a stale tab is open? The stale tab sees round 2 and offers a reload; its commands answer 409 `stale-round`.

## What Changes

- The service answers the page's Approve and Close itself: a Finish notice with `notes`, the Round `finished`.
- `POST /api/review/v1/reviews/:id/cancel`: a Cancel notice, the Round `cancelled`; an ended Review reports its state.
- Open: a finished Review answers `user-ended` unless `reopen`; a cancelled or reopened one starts the next Round on the same link, with a fresh page server.
- Notices persist in `notices.json`, replay until acknowledged; `ack` acknowledges them.
- Page commands carry an optional `round`; stale or ended answer 409 RoundRefusal.
- A page Round stream closes open tabs when their Round ends or a later one opens.

## Capabilities

### Modified Capabilities

- `review-service`: Rounds, Approve, Cancel and list.

## Impact

`packages/server/review-service/{service,records,listen,pages,page-rounds,store}.ts`, `packages/shared/review-api/{page-round,parse}.ts`, `apps/hook/review-page-{base,closure}.ts`, `docs/review-api.md`. Remarks move from `remarks.ts` to `records.ts` with the notices.
