## Why

Owning intent: `/Users/codaveto/Brainspace/intents/das/own-plannotator-at-gates/own-plannotator-at-gates.md`. Story: `/Users/codaveto/Brainspace/intents/das/own-plannotator-at-gates/epic-plannotator-service/discovery.md#14`.

Every part of the service has unit and service tests against a dev run, but nothing proves the epic's "Done when" on the install Brian actually uses: the LaunchAgent on 4397, the binary in `~/.local/bin`, the public door behind ctas. After an install or an upstream update, one command should say whether the whole journey works there.

Pressure test: why not add it to `bun test`? It needs the live service and the VPS; upstream's `bun test` and the Crabbox check run where neither exists, so it would fail there or have to skip, and a skip hides a stopped service. Why not a dev run started by the suite? It would prove the code, not the install; the plugin's e2e already covers the API against any running service. Does it leave traces on the live service? Each scenario uses scratch files and cancels its Reviews; the cancelled Reviews stay in the list, since the API has no delete, as the plugin's e2e already does. Could the public-door check pass for the wrong reason (Caddy down answers 404)? The same link must answer 200 once the Review is public, then 404 again when local.

## What Changes

- `fork/e2e/service.e2e.ts`: health names the LaunchAgent and `~/.local/bin/plannotator --version`; two documents open at once with their own pages and documents; a Remark sent through the page's Send feedback while no one listens reaches a later listener; `plannotator annotate --gate --json` prints `{"decision":"approved"}` after the page's Approve (with the Round from the page's meta tag, as the page sends it); the public door answers 404 for a local Review, 200 once public, 404 again once local.
- `fork/README.md`: how and when to run it (`bun test ./fork/e2e/service.e2e.ts`).

## Capabilities

### Modified Capabilities

- `review-service`: an end-to-end suite proves the installed service.

## Impact

`fork/e2e/service.e2e.ts` (new), `fork/README.md`. No service code.
