## Why

Every listener session whose subscription includes a Review receives each of its Remarks and notices, so the chat session that listens to all Reviews and the agent that opened a Review both get the same Remarks, Approves, Closes and page loads, and both act on them. Brian wants one session per Review: the agent that names the Review gets its events, and the chat session gets every Review no agent holds, without either session subscribing or unsubscribing by hand. He also wants no message when a Review page is opened and no message about other listeners; only what the reviewer or the agent does arrives. Plannotator goes along in the same round as Lavish. Owning intent: `/Users/codaveto/Brainspace/intents/das/review-listen-priority/review-listen-priority.md`.

Success signal: with the chat session subscribed to all Reviews and an agent subscribed to Review A, a Remark on A reaches only the agent; when the agent's socket closes, the chat session receives that Remark if nobody answered it, and every later Remark on A.

## What Changes

- Each Review has a line of the listeners subscribed to it: first the listeners whose subscription names the Review, in the order they started naming it, then the listeners subscribed to all Reviews, in the order they subscribed. The first in line holds the Review.
- Remarks (`feedback_item`) and notices (`finish` for an Approve or a Close, `cancel`) of a Review go to its holder only.
- When the holder leaves the line (its socket closes, it is dropped after a missed ping, or its subscription no longer includes the Review), or a listener that names the Review arrives ahead of a holder subscribed to all, the new holder receives the Review's open Remarks its session did not receive and pending notices its connection did not receive, in store order, then the live events.
- A subscription replays only the Reviews the listener holds after it.
- The listen socket no longer sends `listener` frames (another session listening to the same Review) nor `page_open` frames; a client that still reads them keeps working without them. A page load still records `last_page_open` in the Review list.
- `listeners` in the Review list is in line order, the holder first.
- The review API version becomes 1.1, on `GET /api/review/version` and in `/plannotator/health`.
- `docs/review-api.md` and `fork/README.md` describe the line, the hand-over, the retired frames and the version.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `review-api`: the version is 1.1; the listen socket's messages lose `listener` and `page_open`.
- `review-service`: Remarks and notices go to one holder per Review with hand-over on leave; a subscription replays held Reviews only; the list orders `listeners` by line; health reports API 1.1.

## Impact

`packages/server/review-service/listen.ts` (line per Review, holder routing, hand-over on close, heartbeat drop and subscribe, no `announce` or `pageOpened`, `subscribers` in line order), `packages/server/review-service/service.ts` (a page load no longer calls `listeners.pageOpened`), `packages/shared/review-api/types.ts` (`ListenServerMessage` without `PageOpenEvent` and `ListenerEvent`, `listeners` documented in line order), `packages/shared/review-api/version.ts` (minor 1), `listen.test.ts`, `service.test.ts`, `docs/review-api.md` (Version, List Reviews, Listen to Reviews, Liveness), `fork/README.md` (Review API summary). The page's presence ("agent listening") is unchanged: any listener in a Review's line counts. `plannotator annotate` keeps its own session per call and names its Review, so it holds that Review ahead of a session subscribed to all. Clients: `omp-plannotator-review` drops its `plannotator-page-open` and `plannotator-listener` messages in its own change of the same name; `plannotator-close` stays.

## Constraints

- ADR-0004 (review API v1 matches Lavish) holds for field names and shapes; Lavish retires the same two frames in its change of the same name, so both APIs stay alike. ADR-0004 lists `listener` and `page_open` among the message types and calls a removal a new major; this change treats retiring a server frame a client only reads as a minor, as Brian decided, and a new ADR records that refinement.
- An event reaches one connection at most once, and a Remark reaches one session at most once across reconnects and restarts; hand-over never resends what was already received.

## Non-goals

- No change to how the page shows presence, to `plannotator annotate`'s output, or to Replies: any session may Reply to any Review.
- No priority setting or session roles: a listener's place follows only whether it names the Review and when it subscribed.
- No switch to bring back `listener` or `page_open` frames.

## Assumptions

- A listener's place in a line holds while its subscriptions keep the Review the same way; a reconnected socket joins the back of its group (named or all).
- Dropping `listener` and `page_open` frames needs a minor version only: `omp-plannotator-review` and `plannotator annotate` are the listen socket's only clients, the plugin stops showing both in the same release and annotate ignores both (the update path updates fork and plugin together).
- An annotate call on a file whose Review another session already names waits behind that session and takes the Round's records once that session leaves; Brian does not run annotate and a plugin listener on the same file at once.

## Sources

- `/Users/codaveto/Brainspace/intents/das/review-listen-priority/review-listen-priority.md` (User requests and Brian's answers of 2026-10-02)
- `/Users/codaveto/Worktrees/das/pew-pew-lavish/named-listeners-come-first/openspec/changes/named-listeners-come-first/proposal.md` (the Lavish change this one mirrors)
- `adr/0004-review-api-v1-matches-lavish.md`
- `/Users/codaveto/Repos/Plugins/omp-lavish-review/adr/0004-sessions-listen-over-one-websocket.md`
