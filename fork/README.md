# appboypov/plannotator fork

Brian's fork of [backnotprop/plannotator](https://github.com/backnotprop/plannotator). It follows upstream releases and adds an always-on review service for Markdown documents, the Plannotator peer of `~/Repos/Forks/pew-pew-lavish`: one lasting link per document, Rounds, Remarks and Replies that outlive an agent session, a versioned review API with a listen socket, a public door behind `https://ctas.de-appspecialist.nl/plannotator/`, a temporary door for ngrok, and launchd supervision.

This file is the fork's README: the root `README.md` is upstream's and only points here, so upstream releases merge without conflicts there. `docs/invariants.md` holds the internals and the rules that are easy to break; `docs/review-api.md` is the wire contract.

- Checkout: `~/Repos/Forks/plannotator`. Worktrees: `~/Worktrees/das/plannotator/<branch>`.
- Remotes: `origin` = `appboypov/plannotator`, `upstream` = `backnotprop/plannotator`.
- Base: upstream release `v0.27.22`. The heads before the fresh start are kept as tags `archive/personal-2026-09-30` (old `personal` branch, the one-at-a-time queue and self-updater) and `archive/main-2026-09-30`.
- Owning intent: `~/Brainspace/intents/das/own-plannotator-at-gates/`.

## Install and open a document

On this Mac (macOS, [Bun](https://bun.sh) installed, `~/.local/bin` on `PATH`):

```sh
git clone https://github.com/appboypov/plannotator.git ~/Repos/Forks/plannotator   # skip when it is checked out
cd ~/Repos/Forks/plannotator
bun install --frozen-lockfile
bun fork/build-binary.ts                  # builds fork/dist/plannotator
fork/dist/plannotator service install     # copies it to ~/.local/bin/plannotator and starts the LaunchAgent
plannotator service status                # launchd state and health
curl -s http://127.0.0.1:4397/plannotator/health
```

Health answers HTTP 200 with the version `plannotator --version` prints, such as `0.27.23-appboypov.7cedfb8b`, and `"service": { "label": "nl.de-appspecialist.plannotator" }`. When the omp plugin `omp-plannotator-review` is used, its `bun run setup` (in `~/Repos/Plugins/omp-plannotator-review`) runs these same steps after checking the review API major, and links the plugin.

Open a Markdown file and wait for the reviewer's decision:

```sh
plannotator annotate ~/notes/plan.md              # add --gate --json for an agent gate
```

It prints `Plannotator review, round 1:` and the link, such as `http://127.0.0.1:4397/plannotator/session/0123456789abcdef/`, to stderr, opens the link in the browser (`PLANNOTATOR_SKIP_BROWSER_OPEN=1` keeps it closed), and waits until the reviewer approves, sends feedback or closes the page; then it prints the outcome (`--json`: `{"decision":"approved"}` and the like) and exits.

Open a file without waiting, through the review API:

```sh
curl -s -X POST http://127.0.0.1:4397/api/review/v1/reviews \
  -H 'content-type: application/json' -d "{\"file\":\"$HOME/notes/plan.md\"}" | tee /dev/stderr | jq -r .link | xargs open
# {"review_id":"…","link":"http://127.0.0.1:4397/plannotator/session/…/","status":"opened","round":1,"visibility":"local"}
```

Opening the same file again gives the same link. After an agent's Cancel it starts the next Round there; after the reviewer's Approve or Close it answers `"status": "user-ended"` and changes nothing unless the request adds `"reopen": true` (as `plannotator annotate` does). End a Round from the agent side with `curl -s -X POST http://127.0.0.1:4397/api/review/v1/reviews/<review_id>/cancel`.

## Doors and ports

The service is one process with up to three listeners. Each serves a fixed set of clients; nothing else may connect.

| Door | Address | Who may connect | What it serves |
|---|---|---|---|
| Service | `127.0.0.1:4397` | Processes on this Mac: the browser, `plannotator annotate`, the omp plugin. `Host` must be `127.0.0.1` or `localhost`; a `POST` or listen handshake with a foreign `Origin` or `Referer` gets 403. | Everything: the review API, the listen socket, health, and every Review's page whatever its Visibility. |
| Public | `100.111.186.85:4399` (this Mac's Tailscale address) | Only `100.67.134.112`, the VPS, whose Caddy routes `https://ctas.de-appspecialist.nl/plannotator/*` to it. | Health and the pages of `public` Reviews. |
| Temporary | `127.0.0.1:4398` | Only `127.0.0.1`, the ngrok agent on this Mac (`ngrok http 4398 --url=https://knowledgeably-supersweet-kizzie.ngrok-free.dev`). | Health and the pages of `temporary` Reviews, for that one host. |

The two doors answer 404 to the review API, the listen socket, every WebSocket and every page route outside their list (`packages/server/review-service/door-manifest.ts`), and to any Review whose Visibility is not theirs at the moment of the request. Each Review page also runs an upstream annotate server on a free loopback port, which only the service is told and forwards to. A door opens only when its port setting is set: the LaunchAgent sets both, and `plannotator serve` run by hand in a shell without `PLANNOTATOR_PUBLIC_PORT` and `PLANNOTATOR_TEMPORARY_PORT` opens none. Details: "The doors" in `docs/review-api.md`, `adr/0007-doors-serve-only-their-visibility.md`.

## Visibility

Every Review has one Visibility, which picks its link and the door that serves it:

- `local` (the default): `http://127.0.0.1:4397/plannotator/session/<review_id>/`, this Mac only.
- `public`: `https://ctas.de-appspecialist.nl/plannotator/session/<review_id>/`, anyone with the link.
- `temporary`: `https://knowledgeably-supersweet-kizzie.ngrok-free.dev/plannotator/session/<review_id>/`, anyone with the link while the ngrok tunnel runs (ngrok's free plan shows a warning page first).

Set it when opening (`"visibility": "public"`) or at any time with `POST /api/review/v1/reviews/<review_id>/visibility` `{"visibility":"public"}`; the answer carries the new link. A change takes effect on the next request, and open connections through the old door close at once.

## Review API

`docs/review-api.md` is the contract: Lavish's review API v1 with the same field names (`adr/0004-review-api-v1-matches-lavish.md`), so a Lavish client works against it. In short, on `127.0.0.1:4397`:

- `GET /api/review/version`: `{ "major": 1, "minor": 0 }`; check the major first.
- `POST /api/review/v1/reviews`: open or reopen a file's Review; `GET` lists Reviews (`?file=` adds its open Remarks).
- `POST /api/review/v1/reviews/:id/replies`, `/cancel`, `/visibility`: Reply to Remarks, cancel the Round, change the Visibility.
- `GET /api/review/v1/listen?session=<id>` (WebSocket): subscribe to Reviews; Remarks and Finish or Cancel notices wait on disk until a listener takes them, so a Remark sent while no one listens reaches the next listener.
- `GET /plannotator/health`: version, API major and the LaunchAgent label.

The types are in `packages/shared/review-api/`. `plannotator annotate <file>` on a local file is a client of this API (`apps/hook/server/annotate-service.ts`, `adr/0007-annotate-is-a-client-of-the-service.md`); with no service it fails and says to start it. URLs, folders, `--markdown`, live apps and `--tailscale` keep upstream's one-shot server.

## Settings

`plannotator serve` reads these from its environment; `plannotator service install` carries each one that is set in the installing shell into the LaunchAgent's plist, over the live values, and prints what it installed.

| Setting | Default | What it does |
|---|---|---|
| `PLANNOTATOR_SERVICE_PORT` | `4397` | The service port on 127.0.0.1; `serve --port` wins. `annotate` reads it to find the service. |
| `PLANNOTATOR_REVIEWS_DIR` | `<data dir>/reviews` | One folder per Review. |
| `PLANNOTATOR_DATA_DIR` | `~/.plannotator` | Plannotator's data folder. |
| `PLANNOTATOR_PUBLIC_HOST` | `100.111.186.85` | The public door's address. |
| `PLANNOTATOR_PUBLIC_PORT` | unset (`4399` in the plist) | The public door's port; unset or `off` opens no public door. |
| `PLANNOTATOR_PUBLIC_PEER` | `100.67.134.112` | The one address the public door accepts. |
| `PLANNOTATOR_TEMPORARY_PORT` | unset (`4398` in the plist) | The temporary door's port on 127.0.0.1; unset or `off` opens no temporary door. |
| `PLANNOTATOR_TEMPORARY_ORIGIN` | `https://knowledgeably-supersweet-kizzie.ngrok-free.dev` | The origin of `temporary` links and the one host the temporary door answers. |
| `PLANNOTATOR_SERVICE_LABEL` | set by the plist | The LaunchAgent label health reports; not carried. |

Upstream's own settings, such as `PLANNOTATOR_BROWSER` and `PLANNOTATOR_SKIP_BROWSER_OPEN`, apply to `annotate` as upstream documents them.

## Service under launchd

`plannotator service install` puts the running build at `~/.local/bin/plannotator` and has the LaunchAgent `nl.de-appspecialist.plannotator` run `plannotator serve`: started at login, kept alive, restarted when it exits. Install replaces a loaded service and waits until `/plannotator/health` answers with its version and label; from a source run (`bun apps/hook/server/index.ts`) it refuses and names the build command.

```sh
plannotator service status       # launchd state and health
plannotator service uninstall    # unloads it and removes the plist; the binary stays
```

Logs: `~/Library/Logs/plannotator/nl.de-appspecialist.plannotator.log`. The plist runs the live doors (`PLANNOTATOR_PUBLIC_HOST=100.111.186.85`, `PLANNOTATOR_PUBLIC_PORT=4399`, `PLANNOTATOR_PUBLIC_PEER=100.67.134.112`, `PLANNOTATOR_TEMPORARY_PORT=4398`); a door port of `off` in the installing shell installs the service without that door. Code: `apps/hook/server/{service-command,launch-agent}.ts`, `fork/build-binary.ts`.

## Development

Review state lives in `~/.plannotator/reviews/<review_id>/`; a dev run keeps its own folder and port, and opens no door as long as its shell leaves the door port settings unset. After `bun run build:review && bun run build:hook`:

```sh
PLANNOTATOR_REVIEWS_DIR=/tmp/pn-reviews bun apps/hook/server/index.ts serve --port 4497
```

Code: `packages/server/review-service/` and `apps/hook/server/serve-command.ts`. The plan page calls upstream's root `/api/...` paths; under a session path `packages/shared/review-api/page-base.ts`, installed first by `apps/hook/review-page-base.ts`, sends those `fetch`, `EventSource`, `WebSocket` and image calls to `<page path>api/...` (`adr/0005-one-upstream-annotate-server-per-review.md`). Specs: `openspec/specs/`.

## Rules

- Fork-owned code lives in `fork/` or in new modules of its own. An upstream file gets only a small call site or pointer, so upstream releases merge cleanly. See `adr/0003-fork-owned-code-and-checks.md`.
- Upstream files stay, `.github/` included: upstream tests read `.github/workflows/test.yml`.
- Work runs as OpenSpec changes in `openspec/`, one branch and worktree per change, merged to `main` through a pull request.

## Check

GitHub Actions is off for this fork. The check runs on the VPS through Crabbox:

```sh
crabbox job run check
```

`fork/ci-check.ts` runs the `run` steps of upstream's `test` job in `.github/workflows/test.yml`, in order, with GitHub's bash flags. It removes `CI` from the steps' environment: upstream tests read it as GitHub's runner image and then demand PowerShell. Steps that use a GitHub action (`uses:`) are skipped; checkout and Bun come from Crabbox. The same command runs locally with `bun fork/ci-check.ts`.

## Update

`~/Work/prompts/update-plannotator.md` is the whole update, fork and plugin together. In short:

1. `git fetch upstream --tags` and pick the latest published release on GitHub (a tag without a release is not taken).
2. In a worktree on a new branch from `main`: `git merge <tag>`; resolve conflicts with the fork rules above (upstream's version of a file, with the fork's call site put back).
3. `crabbox job run check`, then a pull request to `main`, merged.
4. `git pull --ff-only` here, then `bun run setup` in `~/Repos/Plugins/omp-plannotator-review`: it builds this checkout, runs `service install` and waits for health. `plannotator --version` and `/plannotator/health` then print the same version.
