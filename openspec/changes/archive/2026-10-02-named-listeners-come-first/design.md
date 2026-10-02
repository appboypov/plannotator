## Context

The listen socket (`packages/server/review-service/listen.ts`, class `ReviewListeners`) keeps one socket per session in `sockets` (a second socket of a session replaces the first and closes it with 1000). Today every socket whose subscription includes a Review gets each of its Remarks and notices (`remarksStored`, `noticeStored` over `listenersOf`), a subscription replays every Review it adds (`receive`), `announce` sends `listener` frames between overlapping sessions, and `pageOpened` sends `page_open` when the service (`service.ts` `page`) serves the page's HTML.

What the change reuses as it is:

- `ReviewRecords.backlog(reviewId)` (`records.ts`): open Remarks and pending notices of a Review, in store order.
- `ReviewListeners.deliver(socket, reviewId, backlog)`: sends what the socket still needs (skips Remarks whose `delivered_to` holds the session, notices in the socket's `sent` set, answered Remarks, acknowledged notices) and records the delivery. Every hand-over and replay goes through it, so the proposal's rule "an event reaches one connection at most once, a Remark one session at most once" holds without new bookkeeping.
- `records.reviewIds()`: the Reviews holding records; a Review without records has nothing to replay or hand over.
- The heartbeat (`ping`): a socket that left the last ping unanswered is terminated, which runs the `close` handler.
- `service.ts` `summary` lists `listeners: listeners.subscribers(id)`; `heartbeatMs` is a service option tests set.

Who reads the retired frames: `apps/hook/server/annotate-service.ts` `receive` acts only on `subscribed`, `error`, and on `feedback_item`, `finish` and `cancel` of its own Round; it never reads `listener` or `page_open`, so annotate's behaviour is unchanged. `omp-plannotator-review` drops its `plannotator-page-open` and `plannotator-listener` messages in its change of the same name. The page's presence reads the list's `listeners`, which keeps every listener in the line.

Docs that describe the socket: `docs/review-api.md` (Version, Health, List Reviews, Listen to Reviews, Liveness), `docs/invariants.md` (replay rule), `fork/README.md` (Review API summary). ADR 0004 lists `listener` and `page_open` among the message types and calls any removal a new major.

Build steps: only the Backend team's service work (`listen.ts`, `service.ts`), the shared contract (`packages/shared/review-api`), its tests and docs. No design, prototype, frontend, data model or infra work: the page and its presence do not change.

## Goals / Non-Goals

**Goals:**

- Each Review has one holder: the first listener in its line (named listeners in the order they started naming it, then `all` listeners in the order they subscribed to all). Remarks, Finish and Cancel notices reach the holder only.
- Whenever the holder of a Review changes (socket closes, replaced, dropped by the heartbeat, subscription no longer includes it, a naming listener joins ahead of an `all` holder), the new holder gets the backlog it has not received before the live events.
- A subscription replays only the Reviews the listener holds after it and did not hold before.
- No `listener` and no `page_open` frames; `listeners` in the list is in line order; review API 1.1.

**Non-Goals:**

- No setting to bring back either frame, no priority setting, no roles, no message about hand-over.
- No change to Replies, acknowledgements (any listener may still acknowledge any notice), the page's presence, or `plannotator annotate`.

## Decisions

- **Place in line as a sequence number per socket.** Each socket keeps `named: Map<ReviewId, number>` (when it started naming each Review) and `all: number | undefined` (when it subscribed to all), taken from one counter in `ReviewListeners`. A subscription keeps the number of a Review it names again, and keeps `all` when it stays `all`; anything new takes the next number. A new socket starts empty, so a replacing socket joins the back of its group. The line is computed on demand: named sockets sorted by their number for the Review, then `all` sockets sorted by `all`. Alternative considered: an explicit ordered list per Review, rejected because Reviews opened after an `all` subscription would need to be added to every list.
- **Hand-over as one diff of holders.** Every line change runs as `change(mutation)`: take the holder of each Review with records, apply the mutation, take them again, and `deliver` the backlog to each Review's new holder. A subscribe, a socket opening (its predecessor of the same session leaves), and the close of the current socket all go through it. The subscribing socket's own deliveries finish before its `subscribed`, which makes "a subscription replays only the Reviews it holds" the same rule as hand-over.
- **A replaced socket leaves the line when its successor opens**, not when its close event arrives later, so no event goes to a socket that is closing.
- **Retiring a frame a client only reads is a minor.** The version becomes 1.1; ADR 0008 records this refinement of ADR 0004 and the one-holder rule, mirroring Lavish's change of the same name.

## Risks / Trade-offs

- [A reconnecting holder briefly hands its Review to the next listener, which then also receives the Review's unanswered Remarks] -> Accepted by the spec: the socket closing is a hand-over; the reconnected socket joins the back of its group.
- [An annotate call whose Review an agent session already names waits behind it] -> Accepted by Brian: first come, first served, no exception.

## Migration Plan

Fork and plugin update together (`bun run setup` of `omp-plannotator-review` builds and installs the service). Plugins check only the major, so an older plugin keeps working with this service and simply receives fewer frames.
