## Context

Build steps (from the epic's Scope): infra, backend, data-models and agent-tools included; design, live-prototype and shared-packages excluded. This change is infra only.

State at branch cut (done as setup before the branch, recorded in the approach's run choices):

- `origin/main` = upstream release `v0.27.22` (`3c9d79b36dbfbfcb7a180a52a9b7c60fc7d315df`); the only branch, and the GitHub default.
- Tags `archive/personal-2026-09-30` (`af5502f7`) and `archive/main-2026-09-30` (`4afdd4cd`) keep the old heads; remote `upstream` = `backnotprop/plannotator`.
- Checkout at `~/Repos/Forks/plannotator`; `personal/` (the old fork guide) is gone with the reset.
- GitHub Actions is already off for the fork: `gh api repos/appboypov/plannotator/actions/permissions` returns `{"enabled":false}`.

Upstream facts that bend the design:

- `.github/workflows/test.yml` job `test` is upstream's Linux check: `bun install --frozen-lockfile`, `check:release-version`, `apps/pi-extension/vendor.sh`, `typecheck`, the UI package smoke, the VS Code extension lint, `bun test`, three `DOM_TESTS=1` runs over hand-kept file lists, and the allowlist guard. Its other jobs need Windows, a global OpenCode install, or a change-gate: not runnable as a plain Linux check.
- `scripts/dom-test-allowlist.test.ts` reads `.github/workflows/test.yml`; `scripts/install.test.ts`, `packages/server/shared-handlers.test.ts`, `packages/shared/review-core.test.ts` and `packages/review-editor/edit/selectionActionPopover.test.ts` also name `.github/workflows`. Deleting workflow files breaks upstream tests.
- `AGENTS.md` (1306 lines, `CLAUDE.md` links to it) and `adr/0001`, `adr/0002` are upstream's.
- Crabbox VPS has Bun 1.4.2 and bash; upstream CI pins Bun 1.3.14. `Bun.YAML.parse` exists in 1.4.2.

Paths outside the repo that name the old checkout: `~/Work/repos/das/plannotator/das/plannotator.md` (`path:` and guide link), `~/Work/skills/plannotator-annotate/SKILL.md:26` (guide link), `~/Brainspace/intents/das/customer-ready-website/SOURCES.md:51`.

## Goals / Non-Goals

**Goals:**

- One Crabbox `check` job that runs upstream's Linux CI steps on the VPS.
- Fork-owned files live under `fork/`; upstream files get at most a short pointer.
- Every record that pointed to the old checkout or the removed guide points to `~/Repos/Forks/plannotator` and `fork/README.md`.

**Non-Goals:**

- Always: keep upstream files and their tests as they are.
- Never: delete `.github/` files, edit upstream tests, or change Plannotator behaviour.
- Never: touch the installed binary (story 1.12).

## Decisions

- **Keep `.github/` and turn Actions off**, instead of deleting the workflows. Deleting breaks five upstream tests and every upstream merge would bring the files back. Actions off already stops them from running.
- **The check reads upstream's `test` job at run time** (`fork/ci-check.ts`): it parses `.github/workflows/test.yml`, takes the `run` steps of job `test` in order and runs each with `bash --noprofile --norc -eo pipefail`, like GitHub's runner, stopping at the first failure. `CI` stays unset: with it, `scripts/install.test.ts:2650` demands PowerShell, which only GitHub's runner image has. A copied command list would drift from upstream on every release; the DOM file lists alone change each release. Alternative `bun install && bun run typecheck && bun test` skips all DOM-gated tests (more than 50 files).
- **`fork/` holds fork-owned files**, `fork/README.md` is the fork guide. `AGENTS.md` gets a short pointer block at its top, so agents find the fork rules; the rest stays upstream's.
- **Fork ADRs continue upstream's sequence** in `adr/` (next: `0003`).

## Risks / Trade-offs

- [Upstream adds a `uses:` step that the check needs, such as a setup action] → the check skips `uses:` steps; a missing tool fails the run loudly, and `fork/README.md` names this.
- [VPS Bun 1.4.2 differs from upstream's pinned 1.3.14] → a failure that only shows on 1.4.2 is reported as a check result, not patched here.
- [Upstream adds its own `adr/0003`] → two files with number 3 and different names; no git conflict.

## Migration Plan

Not applicable: no running system changes.
