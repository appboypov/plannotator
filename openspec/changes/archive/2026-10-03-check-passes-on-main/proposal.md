## Why

Owning intent: `review-listen-priority`, ingested into the brain at `/Users/codaveto/Brainspace/brain/sources/2026-10-02-intent-review-listen-priority.md` (found while building `named-listeners-come-first`; Brian: "fix them now").

`bun fork/ci-check.ts` fails step 7 (Run tests) on `main` at `428efc48` with 5 tests, so neither Crabbox nor the local fallback can prove a change. Each failure has its own cause:

- `scripts/dom-test-allowlist.test.ts`: the fork added the DOM-gated `packages/ui/components/SentRemarks.test.tsx` (`replies-and-round-state-on-the-page`) without naming it in a DOM_TESTS step of `.github/workflows/test.yml`. Fork code.
- `packages/shared/review-core.test.ts` > "renders a file whose index blob is missing from the object database": the temp repo inherits the user's global git config. With `core.autocrlf` set (this Mac has `input`), git will not reuse the working-tree file for a stat-clean index entry, reads the deleted blob and exits 128 (`fatal: unable to read`), on any Bun. Upstream test, not hermetic.
- `apps/pi-extension/server/network.test.ts`, 3 port-retry tests: they expect `listenerCount("listening")` to be 0 after a retry. Node's `http.Server` registers its own `setupConnectionsTracking` "listening" listener at construction; Bun 1.4 does the same (Bun 1.3.14 did not). The fork's Crabbox VPS and this Mac run Bun 1.4.2, upstream's GitHub CI pins 1.3.14. `listenOnPort` removes every listener it adds. Upstream test, tied to Bun 1.3.

Pressure test: does the network fix hide a real leak? A failed attempt that keeps its `listening` listener leaves a listener the server did not own, so the retry tests still fail on that leak, on Bun 1.3, 1.4 and Node.

## What Changes

- `SentRemarks.test.tsx` joins the "Run UI seam-contract + DOM tests" step.
- The missing-blob test pins `core.autocrlf=false` in its temp repo.
- The port-retry tests compare the `listening` listeners with the server's own, taken right after `createServer()`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None: tests and the CI step list only; no behaviour of Plannotator changes.

## Impact

`.github/workflows/test.yml`, `packages/shared/review-core.test.ts`, `apps/pi-extension/server/network.test.ts`. Each upstream file gets a small edit; the review-core and network fixes are upstream test defects worth offering upstream.
