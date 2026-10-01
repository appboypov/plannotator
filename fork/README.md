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

## Review service

`plannotator serve [--port <n>]` runs the service on 127.0.0.1:4397: the review API, `/plannotator/health`, and one page per document under `/plannotator/session/<review_id>/`, each page an upstream annotate server behind the service (`adr/0005-one-upstream-annotate-server-per-review.md`). Review state lives in `~/.plannotator/reviews/<review_id>/`. Settings: `PLANNOTATOR_SERVICE_PORT`, `PLANNOTATOR_REVIEWS_DIR`. A dev run from a checkout, after `bun run build:review && bun run build:hook`:

```sh
PLANNOTATOR_REVIEWS_DIR=/tmp/pn-reviews bun apps/hook/server/index.ts serve --port 4497
```

Code: `packages/server/review-service/` and `apps/hook/server/serve-command.ts`. Contract: `docs/review-api.md`.

The plan page calls upstream's root `/api/...` paths; under a session path `packages/shared/review-api/page-base.ts`, installed first by `apps/hook/review-page-base.ts`, sends those `fetch`, `EventSource`, `WebSocket` and image calls to `<page path>api/...`.

`plannotator annotate <file> [--gate] [--json]` on a local file goes through the running service (`apps/hook/server/annotate-service.ts`): it opens or reopens the file's Review on the port in `PLANNOTATOR_SERVICE_PORT` (else 4397), prints the link, waits for the Round's end on the listen socket and prints upstream's outcome. Calls on different files run at once. With no service it fails and says to run `plannotator serve`. URLs, folders, `--markdown`, live apps and `--tailscale` keep upstream's one-shot server. See "`plannotator annotate` through the service" in `docs/review-api.md`.

## Check

GitHub Actions is off for this fork. The check runs on the VPS through Crabbox:

```sh
crabbox job run check
```

`fork/ci-check.ts` runs the `run` steps of upstream's `test` job in `.github/workflows/test.yml`, in order, with GitHub's bash flags. It removes `CI` from the steps' environment: upstream tests read it as GitHub's runner image and then demand PowerShell. Steps that use a GitHub action (`uses:`) are skipped; checkout and Bun come from Crabbox. The same command runs locally with `bun fork/ci-check.ts`.

## Take an upstream release

1. `git fetch upstream --tags` and pick the latest published release on GitHub (a tag without a release is not taken).
2. In a worktree on a new branch from `main`: `git merge <tag>`; resolve conflicts with the fork rules above.
3. `crabbox job run check`, then a pull request to `main`.
