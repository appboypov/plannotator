## Why

A Review's page lives under `/plannotator/session/<review_id>/`, but upstream's plan page calls its API at the site root (`/api/plan`, `/api/feedback`, `/api/draft`, ...). Behind the service those calls answer 404, so the page shows nothing and can take no annotation (requirement R2). Every later story that touches the page (remarks, Rounds, Replies, the public and temporary doors) needs the page to talk to its own Review.

Owning intent: `/Users/codaveto/Brainspace/intents/das/own-plannotator-at-gates/own-plannotator-at-gates.md`. Story: `/Users/codaveto/Brainspace/intents/das/own-plannotator-at-gates/epic-plannotator-service/discovery.md#4`.

Pressure test (madspec-grilling, answered from the approach and the code, yolo run):
- "Does a relative base cover every fetch, EventSource and asset in the single-file build?" No: the client builds 150-odd root paths (`/api/...`) across `packages/editor` and `packages/ui`; a `<base href>` does not move absolute paths. The single-file build has no other assets to load. The page needs its base applied where its calls leave: `fetch`, `EventSource`, `WebSocket` and image sources.
- "Why not rewrite each call site?" It touches dozens of upstream files and every release adds more. One fork module installed before the page renders keeps upstream files as they are (ADR 0003).
- "What about the review page (`apps/review`)?" Out of scope: the service serves Markdown documents only.
- "Does a plain `plannotator annotate` change?" No: outside a session path nothing is installed.

## What Changes

- New fork module `packages/shared/review-api/page-base.ts`: reads the page's base path from its location (`.../plannotator/session/<id>/`) and, when there is one, sends root `/api/...` calls of `fetch`, `EventSource` and `WebSocket` to that base; returns the rebase for image sources.
- `apps/hook/review-page-base.ts` installs it first in the plan page entry and routes image sources (`/api/image`) through it.
- Small call sites: one import in `apps/hook/index.tsx`, `export` on upstream's default image resolver in `packages/ui/components/ImageThumbnail.tsx`, one export entry in `packages/shared/package.json`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `review-service`: a Review's page works under its own link; its API calls resolve against its base path.

## Impact

- Plan page bundle (`apps/hook/dist/index.html`) gains the installer; behaviour outside a session path is unchanged.
- The agent terminal's WebSocket is rebased too but the service does not forward WebSockets (ADR 0005); the terminal stays unavailable behind the service.
