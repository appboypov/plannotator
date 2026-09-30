# appboypov/plannotator fork

Brian's fork of [backnotprop/plannotator](https://github.com/backnotprop/plannotator). It follows upstream releases and adds an always-on review service for Markdown documents, the Plannotator peer of `~/Repos/Forks/pew-pew-lavish`.

- Checkout: `~/Repos/Forks/plannotator`. Worktrees: `~/Worktrees/das/plannotator/<branch>`.
- Remotes: `origin` = `appboypov/plannotator`, `upstream` = `backnotprop/plannotator`.
- Base: upstream release `v0.27.22`. The heads before the fresh start are kept as tags `archive/personal-2026-09-30` (old `personal` branch, the one-at-a-time queue and self-updater) and `archive/main-2026-09-30`.
- Owning intent: `~/Brainspace/intents/das/own-plannotator-at-gates/`.

## Rules

- Fork-owned code lives in `fork/` or in new modules of its own. An upstream file gets only a small call site or pointer, so upstream releases merge cleanly. See `adr/0003-fork-owned-code-and-checks.md`.
- Upstream files stay, `.github/` included: upstream tests read `.github/workflows/test.yml`.
- Work runs as OpenSpec changes in `openspec/`, one branch and worktree per change, merged to `main` through a pull request.

## Check

GitHub Actions is off for this fork. The check runs on the VPS through Crabbox:

```sh
crabbox job run check
```

`fork/ci-check.ts` runs the `run` steps of upstream's `test` job in `.github/workflows/test.yml`, in order, with GitHub's bash flags. `CI` is not set: upstream tests read it as GitHub's runner image and then demand PowerShell. Steps that use a GitHub action (`uses:`) are skipped; checkout and Bun come from Crabbox. The same command runs locally with `bun fork/ci-check.ts`.

## Take an upstream release

1. `git fetch upstream --tags` and pick the latest published release on GitHub (a tag without a release is not taken).
2. In a worktree on a new branch from `main`: `git merge <tag>`; resolve conflicts with the fork rules above.
3. `crabbox job run check`, then a pull request to `main`.
