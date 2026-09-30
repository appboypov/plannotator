## 1. Infra

- [x] 1.1 `fork/ci-check.ts` -- run the `run` steps of job `test` in `.github/workflows/test.yml` in order with GitHub's bash flags, stop at the first failure, fail clearly when the job is missing -- keeps the check equal to upstream CI
- [x] 1.2 `.crabbox.yaml` -- profile `plannotator`, sync like pew-pew-lavish, preflight `bun` and `bash`, job `check` runs `bun fork/ci-check.ts` -- the one check that gates a merge
- [x] 1.3 `.gitignore` -- add `.crabbox/` in a fork block -- runtime captures stay out of git
- [x] 1.4 `fork/README.md` -- the fork guide: what the fork is, checkout path, remotes and archive tags, taking an upstream release, the check, fork rules -- replaces the removed `personal/README.md`
- [x] 1.5 `AGENTS.md` -- short pointer block at the top to `fork/README.md` and `openspec/` -- agents find the fork rules
- [x] 1.6 `openspec/config.yaml` -- drop the context line that names the missing update prompt; name `fork/README.md` instead -- no dangling reference
- [x] 1.7 `~/Work/repos/das/plannotator/das/plannotator.md`, `~/Work/skills/plannotator-annotate/SKILL.md`, `~/Brainspace/intents/das/customer-ready-website/SOURCES.md` -- point to `~/Repos/Forks/plannotator` and `fork/README.md` -- every path to the old place is updated

## 2. Verification

- [ ] 2.1 `crabbox job run check` passes on the change head; keep the pass count
- [ ] 2.2 `gh api repos/appboypov/plannotator/actions/permissions` returns `"enabled":false`
- [ ] 2.3 `git ls-remote --heads origin` lists only `main` (plus this change's branch while open); `git ls-remote --tags origin 'archive/*'` lists both archive tags
- [ ] 2.4 `rg "References/plannotator|personal/README" ~/Work ~/Brainspace/intents ~/Brainspace/brain` finds nothing outside the own-plannotator-at-gates intent folder
- [ ] 2.5 `openspec validate fork-starts-fresh-from-upstream --type change --strict` passes

## Implementation Notes

Oneshot: about 90 lines over a script, two config files, one guide and three pointer edits. `fork/ci-check.ts` has no unit test: its only logic is running upstream's steps, and the Crabbox run of 2.1 proves it end to end.
Built:

- GitHub Actions was already off for the fork (`{"enabled":false}`), and Dependabot security fixes are off; no bot pull requests exist. Nothing to switch.
- Crabbox was reserved by another project (`envalue-design-system`), so the first run of `fork/ci-check.ts` ran on the Mac. Steps 1 to 6 passed in order (install, release-version, Pi vendor, typecheck, UI package smoke, VS Code lint), which proves the step runner. Step 7 (`bun test`) failed on the Mac: `scripts/install.test.ts:2650` demands PowerShell when `CI` is set (fixed: `CI` is no longer set), and upstream's `packages/server/api-404-guard.test.ts` timed out at 5 s per test plus one `Save Notes` JSON parse error. Those are upstream tests; the full check on the pull request head through Crabbox decides them.
- Story 1's `description`, `verify` and Scope in the epic's `discovery.md` now say "Actions off, workflow files stay" in place of "no `.github/workflows`"; Change Log has the dated Decision.
- Outside the repo: `~/Work` commit `721d1538f` (repo record and `plannotator-annotate` skill), `~/Brainspace/intents/das/customer-ready-website/SOURCES.md:51` and `prd-addendum.md:46`. `~/Work/specs/das/work/work/DAS-113/spec.md:29` names an even older path in a finished spec; it is history and stays.

## Plan Change Log

- 2026-09-30: planned in yolo mode; choices recorded in the approach's run choices.

## Review Triage Log
