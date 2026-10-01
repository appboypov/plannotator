## Why

Owning intent: `/Users/codaveto/Brainspace/intents/das/own-plannotator-at-gates/own-plannotator-at-gates.md`. Story: `/Users/codaveto/Brainspace/intents/das/own-plannotator-at-gates/epic-plannotator-service/discovery.md#8`.

Remarks reach the agent, but its answer has nowhere to go: the Replies route answers 404 and only the stub fakes it. A client reading the page should see the agent's answer beside the Remark it answers, on the same link, also after the service restarts.

Pressure test: what if a Reply names a Remark of another Review? It is unknown to this Review: 400 `UnknownRemarksResponse`, nothing written. What if the Round ended? Replies are allowed on an ended Review (Lavish semantics) and the finished page still shows them. What if a Reply names no Remark? It is stored and shown apart, and leaves every Remark open.

## What Changes

- `POST /api/review/v1/reviews/:review_id/replies` stores the Reply in `<review>/replies.json` and marks each named Remark `answered`, so it is no longer replayed.
- `GET <link>api/review-replies` (`PAGE_REPLIES_PATH`) answers the page with `ReviewRepliesResponse`: every Remark with its Replies, then the Replies naming none.
- The review API stub and its docs section are deleted: the service answers every route.

## Capabilities

### Modified Capabilities

- `review-service`: Replies on a Remark.
- `review-api`: the stub is gone; scenarios run against the service.

## Impact

`packages/server/review-service/{records,service}.ts`, `packages/shared/review-api/{types,routes}.ts`, `docs/review-api.md`; deleted `packages/server/review-api/stub.ts`. Story 9 draws the Replies on the page from the new page route.
