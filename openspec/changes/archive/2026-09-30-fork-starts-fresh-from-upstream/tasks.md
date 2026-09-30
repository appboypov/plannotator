## 1. Infra

- [x] 1.1 `fork/ci-check.ts` -- run the `run` steps of job `test` in `.github/workflows/test.yml` in order with GitHub's bash flags, stop at the first failure, fail clearly when the job is missing -- keeps the check equal to upstream CI
- [x] 1.2 `.crabbox.yaml` -- profile `plannotator`, sync like pew-pew-lavish, preflight `bun` and `bash`, job `check` runs `bun fork/ci-check.ts` -- the one check that gates a merge
- [x] 1.3 `.gitignore` -- add `.crabbox/` in a fork block -- runtime captures stay out of git
- [x] 1.4 `fork/README.md` -- the fork guide: what the fork is, checkout path, remotes and archive tags, taking an upstream release, the check, fork rules -- replaces the removed `personal/README.md`
- [x] 1.5 `AGENTS.md` -- short pointer block at the top to `fork/README.md` and `openspec/` -- agents find the fork rules
- [x] 1.6 `openspec/config.yaml` -- drop the context line that names the missing update prompt; name `fork/README.md` instead -- no dangling reference
- [x] 1.7 `~/Work/repos/das/plannotator/das/plannotator.md`, `~/Work/skills/plannotator-annotate/SKILL.md`, `~/Brainspace/intents/das/customer-ready-website/SOURCES.md` -- point to `~/Repos/Forks/plannotator` and `fork/README.md` -- every path to the old place is updated

## 2. Verification

- [x] 2.1 The full check (`crabbox job run check`, or its local fallback per `madspec-remote-checks-and-tests` while Crabbox is reserved) passes on the change head; tests that fail the same way on upstream `main` on the same machine are recorded, not fixed; keep the pass count
- [x] 2.2 `gh api repos/appboypov/plannotator/actions/permissions` returns `"enabled":false`
- [x] 2.3 `git ls-remote --heads origin` lists only `main` (plus this change's branch while open); `git ls-remote --tags origin 'archive/*'` lists both archive tags
- [x] 2.4 `rg "References/plannotator|personal/README" ~/Work ~/Brainspace/intents ~/Brainspace/brain` finds nothing outside the own-plannotator-at-gates intent folder, except the finished DAS-113 spec (history)
- [x] 2.5 `openspec validate fork-starts-fresh-from-upstream --type change --strict` passes

## Implementation Notes

Oneshot: about 90 lines over a script, two config files, one guide and three pointer edits. `fork/ci-check.ts` has no unit test: its only logic is running upstream's steps, and the Crabbox run of 2.1 proves it end to end.

Built:

- GitHub Actions was already off for the fork (`{"enabled":false}`), and Dependabot security fixes are off; no bot pull requests exist. Nothing to switch.
- Crabbox was reserved by another project (`envalue-design-system`), so the first run of `fork/ci-check.ts` ran on the Mac. Steps 1 to 6 passed in order (install, release-version, Pi vendor, typecheck, UI package smoke, VS Code lint), which proves the step runner. Step 7 (`bun test`) failed on the Mac: `scripts/install.test.ts:2650` demands PowerShell when `CI` is set (fixed: `CI` is no longer set), and upstream's `packages/server/api-404-guard.test.ts` timed out at 5 s per test plus one `Save Notes` JSON parse error. Those are upstream tests; the full check on the pull request head through Crabbox decides them.
- Story 1's `description`, `verify` and Scope in the epic's `discovery.md` now say "Actions off, workflow files stay" in place of "no `.github/workflows`"; Change Log has the dated Decision.
- Outside the repo: `~/Work` commit `721d1538f` (repo record and `plannotator-annotate` skill), `~/Brainspace/intents/das/customer-ready-website/SOURCES.md:51` and `prd-addendum.md:46`. `~/Work/specs/das/work/work/DAS-113/spec.md:29` names an even older path in a finished spec; it is history and stays.
- Verifier, 2026-09-30: Crabbox was still reserved by `envalue-design-system`. The full run on the Mac, at head `2002f9f7`: steps 1 to 6 passed; `bun test` had 5439 pass, 1264 skip and 10 fail. The fails do not come from this diff, which changes no runtime code: the PowerShell guard (the agent shell had exported `CI=true`, fixed: the check now removes `CI` from the steps' environment, proven with a throwaway workflow: steps saw `CI=unset`, a `uses:` step was skipped, and the run stopped at the first failing step with its exit code), three port-selection tests (ports in use on the Mac), five `api-404-guard` tests (5 s timeouts) and one `review-core` missing-blob test.
- Verifier, 2026-09-30: Crabbox still reserved and no agent runs in `envalue-design-system`; the skill says never take over a reservation and never stall on it, so the local fallback is the evidence. Steps 1 to 7 ran at `2002f9f7` (above). `6a3479a1` changes only how the check passes `CI`, plus docs; at `6a3479a1` steps 8 to 11 passed (6, 18, 1311 and 1 tests, 0 fail), and the four step-7 test files with fails ran alone with `CI` unset: the PowerShell test and the five `api-404-guard` tests pass. The other 4 (`packages/shared/review-core.test.ts` missing-blob; `apps/pi-extension/server/network.test.ts` three port tests) fail the same way on upstream `main` `3c9d79b3` (`v0.27.22`) on this Mac: 112 pass, 4 fail on both. They are upstream or Mac-setup failures; this change adds no runtime code.

## Plan Change Log

- 2026-09-30: planned in yolo mode; choices recorded in the approach's run choices.

## Review Triage Log

- 2026-09-30: madspec-local-review, codex gpt-6-sol, effort low: no findings; no second run.
