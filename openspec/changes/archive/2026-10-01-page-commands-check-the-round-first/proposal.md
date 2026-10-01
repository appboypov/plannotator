## Why

Owning intent: `/Users/codaveto/Brainspace/intents/das/own-plannotator-at-gates/own-plannotator-at-gates.md`. Story: `/Users/codaveto/Brainspace/intents/das/own-plannotator-at-gates/epic-plannotator-service/discovery.md#6` (follow-up fix).

A page command (Send feedback, Approve, Close) checked its Round against the Review as it was before its body arrived, then cleared the page's draft. When the Round was cancelled and reopened meanwhile, a round 1 command deleted round 2's draft (drafts are keyed by the document, not the Round) before it was refused with 409 stale-round.

Pressure test: what if the Round moves on during the draft clear itself? The second check after the clear still refuses the command and nothing is stored; only that in-flight clear can reach the page, which the first check now makes as late as possible.

## What Changes

- `pageCommand` reads the Review after its body arrived and checks the Round before clearing any draft, clearing on the page of that current Review.

## Capabilities

### Modified Capabilities

- `review-service`: a refused page command keeps the open Round's draft.

## Impact

`packages/server/review-service/service.ts`, `listen.test.ts`.
