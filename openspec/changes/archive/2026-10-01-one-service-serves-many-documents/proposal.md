## Why

Upstream Plannotator runs one server per command: `plannotator annotate <file>` opens one page on a random port and the page dies with the process. Brian's gates need a link per Markdown document that lasts for days and two documents open at once (approach Part 2, requirements R2 and R3). This is the tracer bullet's first layer: without one service that serves many documents, the page, Remarks, Rounds, the CLI route and the plugin have nothing to run against.

Owning intent: `/Users/codaveto/Brainspace/intents/das/own-plannotator-at-gates/own-plannotator-at-gates.md`. Story: `/Users/codaveto/Brainspace/intents/das/own-plannotator-at-gates/epic-plannotator-service/discovery.md#3`.

Pressure test (madspec-grilling, answered from the approach and the contract, yolo run):
- "Why not a new page for the service?" The page is upstream's plan page and its server handlers; a second page would drift from every upstream release. Each Review gets upstream's own annotate server, behind the service.
- "How much of the annotate server's per-process state must move into a per-Review registry?" None: one upstream annotate server per Review keeps decision, client lease and drafts per Review by construction, and no upstream file changes shape.
- "What makes an id last?" The id is derived from the file's canonical path, like Lavish, and the Review's state is written to its own folder, so a restart and a second open both find it.
- "Does the stub go?" No, not yet: it answers routes this story does not build (listen, Replies, Cancel), which epic 2 builds against. It goes once the service answers every route.

## What Changes

- New subcommand `plannotator serve [--port <n>]`: one long-lived server on 127.0.0.1, port 4397 unless `--port` or `PLANNOTATOR_SERVICE_PORT` says otherwise.
- Review API v1 routes served for real: version, open (`POST /api/review/v1/reviews`), list, and Visibility; `/plannotator/health`.
- A Review's id is the first 16 hex characters of the SHA-256 of its canonical path; opening the same file again returns the same id and link.
- Each Review keeps its state in its own folder, `<reviews dir>/<review_id>/review.json`; the reviews dir is `<data dir>/reviews` (`~/.plannotator/reviews`) unless `PLANNOTATOR_REVIEWS_DIR` names another. Reviews survive a restart.
- The Review page at `/plannotator/session/<review_id>/` is upstream's plan page served by an upstream annotate server started for that Review's document; the service forwards `/plannotator/session/<id>/<rest>` to it, so `GET /plannotator/session/<id>/api/plan` returns that file's content.
- Not built here, answering 404 until their stories land: the listen socket (story 5), Cancel (story 6), Replies (story 8). The stub keeps answering them for client builders.

## Capabilities

### New Capabilities

- `review-service`: the always-on service: serve mode and its settings, lasting Review ids, per-Review state folders, per-Review pages under their own path, health and version.

### Modified Capabilities

None. The `review-api` contract is unchanged; this change implements part of it.

## Impact

- New fork-owned module `packages/server/review-service/` (`@plannotator/server/review-service`) and `apps/hook/server/serve-command.ts`.
- Small call sites in upstream files: the `serve` branch in `apps/hook/server/index.ts`, `serve` in the internal subcommand list of `apps/hook/server/unknown-subcommand.ts`, one export line in `packages/server/package.json`.
- Docs: `docs/review-api.md` (service section), `fork/README.md`. ADR 0005.
- No change to `plannotator annotate` or any other upstream command. The installed `~/.local/bin/plannotator` and LaunchAgents are untouched (story 12 installs the service).
- The page's own client still calls root `/api/...` until story 4 makes it call relative to its path.
