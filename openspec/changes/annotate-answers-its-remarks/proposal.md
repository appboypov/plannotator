## Why

Since review API 1.1 one listener holds each Review. `plannotator annotate` takes a Round's Remarks, cancels the Round, acknowledges the Cancel notice and leaves with an empty subscription, but never answers the Remarks, so they stay `open`. Leaving hands the Review to the next listener in line, and a session subscribed to all then receives the same Remarks as `feedback_item`, after the terminal already printed them; the Review list keeps counting them in `open_item_count`. The intent wants each Remark to reach one consumer. Found by Sarkout while verifying `named-listeners-come-first` (`~/Brainspace/proposals/das/named-listeners-come-first/annotate-remarks-hand-over.md`). Owning intent: `/Users/codaveto/Brainspace/intents/das/review-listen-priority/review-listen-priority.md`.

Success signal: with a session on all and an annotate call on `plan.md`, the reviewer's feedback settles the call, the session on all receives no `feedback_item` for it, and the list shows `open_item_count: 0`.

## What Changes

- After an annotate call takes Remarks and the Round's Cancel notice arrives, it posts one Reply (`POST /api/review/v1/reviews/<id>/replies`, text `Received by plannotator annotate.`) answering every Remark it took, and only then leaves the Review's line. Answered Remarks are not handed over and not counted as open.
- A Reply that fails is logged; the call still prints the feedback it took.
- `docs/review-api.md` and `docs/invariants.md` describe the Reply.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `annotate-command`: a call that takes Remarks answers them with one Reply before it leaves the Review's line.

## Impact

`apps/hook/server/annotate-service.ts` (`waitForRound`: answer before settle), `apps/hook/server/annotate-service.test.ts`, `docs/review-api.md` (annotate section), `docs/invariants.md` (annotate invariant). No change to the service, the review API or the listen socket.

## Constraints

- Uses the existing Reply path; the review API has no way to answer a Remark without a Reply, and a Reply shows on the page beside the Remarks it answers, so the reviewer sees `Received by plannotator annotate.` under each Remark the call took.
- An event reaches one connection at most once, and a Remark reaches one session at most once (ADR 0008).

## Non-goals

- No new review API route or silent answer; no service-side answering of a cancelled Round's Remarks.
- No change to annotate's printed output, exit codes or Round handling.

## Assumptions

- Brian accepts the visible Reply on the page; it tells the reviewer the terminal received the feedback.

## Sources

- `/Users/codaveto/Brainspace/proposals/das/named-listeners-come-first/annotate-remarks-hand-over.md`
- `/Users/codaveto/Brainspace/intents/das/review-listen-priority/review-listen-priority.md`
- `adr/0007-annotate-is-a-client-of-the-service.md`, `adr/0008-one-listener-holds-each-review.md`
