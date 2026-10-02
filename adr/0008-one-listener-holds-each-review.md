# 8. One listener holds each Review

Date: 2026-10-02

## Status

Accepted

## Context

ADR 0004 gives the listen socket Lavish's message types, `listener` and `page_open` among them, and calls a removal of any field a new major. Every listener whose subscription included a Review received its Remarks and notices, so the chat session listening to all Reviews and the agent that opened a Review both acted on the same events. Brian wants one session per Review, with no frame about page loads or other listeners, and Lavish makes the same change, so both review APIs stay alike.

## Decision

- Each Review has a line of the listeners whose subscription includes it: first those that name the Review, in the order they started naming it, then those subscribed to all Reviews, in the order they subscribed to all. A listener keeps its place while its subscriptions keep the Review the same way; a new socket joins the back of its group. The first in line holds the Review.
- Remarks and Finish and Cancel notices go to the holder only. When the holder changes, the new holder first receives the open Remarks its session and the pending notices its socket did not receive, in store order. A subscription replays only the Reviews its listener holds after it.
- The listen socket sends no `listener` and no `page_open` frames.
- Retiring a server frame that clients only read is a minor version, not a new major: clients check only the major and ignore what they do not receive. The review API becomes 1.1. ADR 0004's rule still holds for every field and for every client message.

## Consequences

- The chat session receives every Review no agent names, without subscribing or unsubscribing by hand, and gets a Review back with its unanswered Remarks and pending notices when the agent leaves.
- A session that needs a Review's events names it; `all` never comes before a name.
- `plannotator annotate` names its Review too, so a call on a file an agent session already names waits behind that session.
- The `listeners` list is in line order, holder first.
