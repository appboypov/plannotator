## Why

Owning intent: `/Users/codaveto/Brainspace/intents/das/own-plannotator-at-gates/own-plannotator-at-gates.md`. Story: `/Users/codaveto/Brainspace/intents/das/own-plannotator-at-gates/epic-plannotator-service/discovery.md#6` (follow-up fix).

A Visibility change read the Review before awaiting its request body, and a page load read it before awaiting the page's HTML. Both then saved that old record, so a Cancel or reopen that landed in between was undone on disk and in memory.

Pressure test: what if a reopen lands between the HTML and the save? The save now reads the Review after the HTML arrived, with no await before it, so the new Round stands; the pinned Round may be the old one, and the page's Round stream then offers the reload.

## What Changes

- `setVisibility` and the page-load `last_page_open` save read the current Review immediately before saving.

## Capabilities

### Modified Capabilities

- `review-service`: metadata saves keep the latest Round.

## Impact

`packages/server/review-service/service.ts`, `service.test.ts`.
