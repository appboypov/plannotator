## Why

Brian wants our own Plannotator, started fresh from the original project, as the base for an always-on review service like our Lavish fork. The old fork carried a personal branch (one-at-a-time queue, self-updater) that the new design drops, and it lived in `~/Repos/References/` with no OpenSpec root and no checks of its own, so no story of the service can be built on it yet.

Success signal: `appboypov/plannotator` `main` equals upstream release `v0.27.22` plus only fork commits, the old heads are kept as archive tags on GitHub, the checkout is `~/Repos/Forks/plannotator`, GitHub runs no workflow on the fork, and `crabbox job run check` passes on `main`.

## What Changes

- `main` is reset to upstream `v0.27.22` and is the only branch and the GitHub default; `personal` and `updates/v0.27.14` are deleted; tags `archive/personal-2026-09-30` and `archive/main-2026-09-30` keep the old heads. (Done as setup before this change's branch was cut.)
- The checkout moves to `~/Repos/Forks/plannotator`; every record and skill that pointed to `~/Repos/References/plannotator` points to the new place.
- GitHub Actions is turned off for the fork, so the upstream workflows never run there; the workflow files stay, since upstream tests read them.
- A Crabbox `check` job runs the same steps upstream CI runs, taken from upstream's test workflow at run time, so a new upstream check comes along with each release.
- The repository gets an OpenSpec root on the `intent-driven` schema and an `AGENTS.md` section that names the fork's rules and its check.

## Capabilities

### New Capabilities

None: this change sets up the repository and changes no behaviour of Plannotator.

### Modified Capabilities

None.

## Impact

- GitHub `appboypov/plannotator`: default branch, branches, tags, Actions setting.
- Repository: `openspec/`, `.crabbox.yaml`, `.gitignore`, a fork-owned check script, `AGENTS.md`.
- Outside the repository: `~/Work/repos/das/plannotator/das/plannotator.md`, `~/Work/skills/plannotator-annotate/SKILL.md`, `~/Brainspace/intents/das/customer-ready-website/SOURCES.md`.
- The installed binary `~/.local/bin/plannotator` (`0.27.12-appboypov.af5502f7`) is not touched; story 1.12 replaces it.

## Constraints

- Fork changes live in fork-owned files with small call sites in upstream files, so upstream releases merge cleanly.
- Upstream files are not deleted or rewritten for fork setup; upstream tests read `.github/workflows/test.yml`.
- Checks run on the VPS through Crabbox, per `madspec-remote-checks-and-tests`.

## Non-goals

- Any change to Plannotator's behaviour: stories 1.2 to 1.14.
- Replacing the installed binary or its personal updater: story 1.12.
- Removing the `plannotator-annotate` skill: epic 7.

## Assumptions

- "Latest upstream release" means the latest published GitHub release: `v0.27.22`. Tag `v0.27.23` exists upstream but has no published release yet.

## Sources

- Intent: `/Users/codaveto/Brainspace/intents/das/own-plannotator-at-gates/own-plannotator-at-gates.md`
- Story: `/Users/codaveto/Brainspace/intents/das/own-plannotator-at-gates/epic-plannotator-service/discovery.md#1`
- Approach, Part 1: `/Users/codaveto/Brainspace/intents/das/own-plannotator-at-gates/approach-own-plannotator-at-gates.md`
- Parity: `~/Repos/Forks/pew-pew-lavish/.crabbox.yaml`, `~/Repos/Forks/pew-pew-lavish/openspec/config.yaml`
