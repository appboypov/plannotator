## Why

Owning intent: `/Users/codaveto/Brainspace/intents/das/own-plannotator-at-gates/own-plannotator-at-gates.md`. Story: `/Users/codaveto/Brainspace/intents/das/own-plannotator-at-gates/epic-plannotator-service/discovery.md#9` (follow-up fix).

Reported: after an agent Cancel, the open Review page did not show "Round N was cancelled". Reproduced on a dev service: in the shared relay Chrome the page's `EventSource` was wrapped by a leftover test stub ("A stream that never delivers, as on a sleeping laptop or a buffering proxy") that pointed every `review-round` stream at `data:text/event-stream,`, so no Round event reached the page. In a clean Chrome profile the cover appears live and after reload. The service and the page were not at fault for that report.

The same run found a real defect: a page that shows an ended Round's cover kept it for good. The cover says "It opens again when the agent asks for another review", but when the agent reopened the Review into the next Round the tab still said "Round N was cancelled" (or "is finished"), because the page showed at most one closure.

## What Changes

- The page shows an ended Round's closure once, and a later Round's closure once after it; the later one replaces the ended cover and offers the reload. Nothing replaces a later Round's cover.
- The cover module replaces an earlier cover instead of stacking a second one, and adds its key guard once.

## Capabilities

### Modified Capabilities

- `review-service`: an ended Round's cover gives way to the next Round's.

## Impact

`packages/shared/review-api/page-round.ts`, `page-round.test.ts`, `apps/hook/review-page-closure.ts`.
