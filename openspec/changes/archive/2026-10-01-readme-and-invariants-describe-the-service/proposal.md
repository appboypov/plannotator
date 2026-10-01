## Why

Owning intent: `/Users/codaveto/Brainspace/intents/das/own-plannotator-at-gates/own-plannotator-at-gates.md`. Story: `/Users/codaveto/Brainspace/intents/das/own-plannotator-at-gates/epic-plannotator-service/discovery.md#13`.

The service, its three doors, Visibility, the review API and the launchd install are built, but a reader who lands on the repository sees upstream's README, and `fork/README.md` explains each part as it was added rather than how to install and use the whole. Later sessions and the update prompt need one place that says how to install, open a document and update, and one place that names every port and who may connect, as Lavish has in `docs/invariants.md`.

Pressure test: why not put the fork's guide into the root `README.md`? Upstream rewrites that file in most releases; a large fork block there conflicts on every merge (ADR 0003). A few lines at the top that point to `fork/README.md` conflict at most on those lines. Why not let `docs/review-api.md` be the guide? It is the wire contract for clients; it does not say how to install or which shell settings matter. Could two docs drift? Each owns a part: `fork/README.md` what a user does and sees, `docs/invariants.md` the internals and rules, `docs/review-api.md` the wire; each points to the others instead of repeating them.

## What Changes

- Root `README.md`: a short fork notice at the top that names the service and points to `fork/README.md` (the single source for the fork) and `docs/invariants.md`; upstream's text stays unchanged below it.
- `fork/README.md` restructured: install and open a document (both `plannotator annotate` and the review API), doors and ports with who may connect, Visibility, review API summary, settings table, launchd, development, rules, check and update.
- New `docs/invariants.md`: every port and who may connect, door rules, state, Rounds and the page, install and update invariants.

## Capabilities

### New Capabilities

- `service-docs`: where the fork documents its service and what each document owns.

## Impact

`README.md` (top lines only), `fork/README.md`, `docs/invariants.md`. No code.
