## Context

Lavish runs its server under the LaunchAgent `nl.de-appspecialist.lavish-axi` written by `lavish-axi service install` (`~/Repos/Forks/pew-pew-lavish/src/launch-agent.js`). Plannotator ships as one compiled Bun binary; upstream's release job compiles `apps/hook/server/index.ts` with `__CLI_VERSION__`.

## Decisions

- **The binary installs itself.** A compiled `plannotator` cannot rebuild its own source, so the build is a fork script (`bun fork/build-binary.ts`) and `service install` copies `process.execPath` into `~/.local/bin` through a temporary file and a rename. Run from `~/.local/bin` it only reloads the LaunchAgent. A run from source refuses, since its executable is Bun.
- **Version names the commit.** `<package version>-appboypov.<8-char commit>`, the scheme of the old personal builds, so health tells which fork build runs.
- **launchd replaces in place.** `bootout` then `bootstrap`, retried for 5 s while launchd finishes unloading, as Lavish does. KeepAlive restarts the process on any exit.
- **Settings are carried, not invented.** The doors' defaults live in `plannotator serve`; the plist only carries the named settings that are set when install runs, so one source owns each default.
- **Health names the label.** `PLANNOTATOR_SERVICE_LABEL` makes health answer `service.label`, so install and the plugin's setup can tell the LaunchAgent's server from a stray one on the port.
- **Logs** go to `~/Library/Logs/plannotator/nl.de-appspecialist.plannotator.log`, stdout and stderr together.

## Risks

- A stray `plannotator serve` on 4397 makes the LaunchAgent's process exit and restart until it is stopped; install reports the stray from health.
