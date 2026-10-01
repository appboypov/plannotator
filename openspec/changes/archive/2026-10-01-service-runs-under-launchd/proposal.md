## Why

Owning intent: `/Users/codaveto/Brainspace/intents/das/own-plannotator-at-gates/own-plannotator-at-gates.md`. Story: `/Users/codaveto/Brainspace/intents/das/own-plannotator-at-gates/epic-plannotator-service/discovery.md#12`.

The review service only runs while someone keeps `plannotator serve` open in a terminal, and the `plannotator` on this Mac is still the old personal fork. "Stays open like Lavish" needs the service under launchd: installed from the fork's build, started at login, restarted when it dies.

Pressure test: what if `service install` runs from source (`bun apps/hook/server/index.ts`)? Its executable is Bun, not plannotator: install refuses and touches nothing. What if another server holds 4397? Health names no LaunchAgent label or another version: install fails and names what answers. What if a dev shell carries `PLANNOTATOR_SERVICE_PORT`? Install carries the named settings it finds into the plist and prints them, so the run shows it.

## What Changes

- `plannotator service install|uninstall|status`: install copies the running compiled binary to `~/.local/bin/plannotator` and loads LaunchAgent `nl.de-appspecialist.plannotator` (RunAtLoad, KeepAlive, logs in `~/Library/Logs/plannotator/`), replacing a loaded one, then waits for health to answer with its own version and label. Uninstall unloads it and removes the plist; status shows launchd's state and health.
- The plist carries `PLANNOTATOR_SERVICE_LABEL`, a PATH with Homebrew and `~/.local/bin`, and the port, reviews, data dir and door settings set in the installing environment.
- `/plannotator/health` adds `service: { label }` when launchd runs the service.
- `bun fork/build-binary.ts` builds the pages and compiles `fork/dist/plannotator` for this Mac with version `<package version>-appboypov.<commit>`.
- Not ported: the old one-at-a-time queue and personal self-updater (tag `archive/personal-2026-09-30`).

## Capabilities

### Modified Capabilities

- `review-service`: the service runs under launchd.

## Impact

New `apps/hook/server/{launch-agent,service-command}.ts`, `fork/build-binary.ts`; call sites in `apps/hook/server/{index,unknown-subcommand,serve-command}.ts`; health in `packages/server/review-service/service.ts` and `packages/shared/review-api/types.ts`; `fork/README.md`. The plugin's `bun run setup` (epic 2 story 4) runs the build and `service install`.
