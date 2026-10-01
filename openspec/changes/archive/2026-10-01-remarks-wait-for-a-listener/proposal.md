## Why

A reviewer's annotations must reach the agent that opened the Review, even when no agent listens at the moment the reviewer sends them (requirements R3, R4). Behind the service, upstream's Send feedback goes to the Review's page server, which settles its one decision and answers a later send with `alreadyDecided`; nothing is stored per Remark and no listen socket exists, so the omp plugin has nothing to hear.

Owning intent: `/Users/codaveto/Brainspace/intents/das/own-plannotator-at-gates/own-plannotator-at-gates.md`. Story: `/Users/codaveto/Brainspace/intents/das/own-plannotator-at-gates/epic-plannotator-service/discovery.md#5`.

Pressure test (madspec-grilling, answered from the approach, the contract and the code, yolo run):
- "Why not let the page server settle feedback and read its decision?" Upstream settles once per server (`decision.settle` in `annotate.ts`); a second Send feedback gets `alreadyDecided`, and the decision holds the formatted text, not one record per annotation. The service answers the page's `api/feedback` itself and keeps the page server for everything else.
- "Replay on every reconnect, as Lavish does, or once?" The story asks that a reconnect does not deliver Remarks again. The service stores per Remark the sessions it reached; a reconnect under the same session gets nothing old, a new session still gets every open Remark until a Reply answers it (story 1.8). Remarks stay open and counted.
- "Where do Remarks live?" Next to the Review's `review.json`, in `remarks.json`, so they survive restarts and stay in the Review's folder.
- "Does Approve change?" No; Approve, Rounds, Cancel and notices are story 1.6.

## What Changes

- Send feedback on a Review's page (`POST <link>api/feedback`) stores one Remark per annotation (id `fi_` + 24 hex) in `<reviews dir>/<review_id>/remarks.json`, sends them to the Review's listeners, clears the sent draft on the page server, and answers `{ "ok": true }`.
- The listen socket `/api/review/v1/listen?session=` on the service: subscribe with replay of open Remarks the session has not received, `listener` and `page_open` events, `subscribed`, error frames, 64 KiB frame limit (1009), one socket per session, a 30 second heartbeat.
- The list reports `open_item_count`, `listeners` and, for one file, `open_items`.
- `docs/review-api.md`: the once-per-session delivery rule, the Remarks file, Send feedback, and what is built.
- ADR 0006: the service answers the page's decisions itself.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `review-service`: Remarks are stored per Review and wait for a listener; the service answers the listen socket.

## Impact

- New fork modules `packages/server/review-service/remarks.ts` and `listen.ts`; `service.ts` routes Send feedback and the socket.
- The omp plugin can listen to the real service; the stub stays for Cancel and Replies.
- A plain `plannotator annotate` is unchanged.
