# Review service invariants

This file owns the fork's review service internals: which ports exist and who may connect to each, where state lives, and the rules that are easy to break. `fork/README.md` owns the user-facing part (install, open a document, Visibility, settings, update); `docs/review-api.md` owns the wire contract. When a change touches a rule below, update this file; when it touches what a user or client sees, update those two instead. Decisions: `adr/0003` to `adr/0007`. Parity reference: `~/Repos/Forks/pew-pew-lavish/docs/invariants.md`.

## Ports and who may connect

The live service is one process, `plannotator serve` run by the LaunchAgent `nl.de-appspecialist.plannotator`. It has exactly these listeners:

| Port | Bound to | Who may connect | Enforced by |
|---|---|---|---|
| `4397` (service) | `127.0.0.1` only | Any process on this Mac. Requests must carry `Host` `127.0.0.1:4397` or `localhost:4397`; a `POST` or listen handshake with an `Origin` or `Referer` from another origin gets 403 `forbidden`. Header-less clients (the CLI, the plugin, `curl`) pass. | The bind address; `isLocalRequest` in `packages/shared/review-api/parse.ts`. |
| `4399` (public door) | `100.111.186.85`, this Mac's Tailscale address | Only `100.67.134.112`, the VPS. Its Caddy routes `https://ctas.de-appspecialist.nl/plannotator/*` here; nobody else reaches this port. | The peer check in `packages/server/review-service/doors.ts`, before a byte is read. |
| `4398` (temporary door) | `127.0.0.1` | Only `127.0.0.1`: the ngrok agent on this Mac, run as `ngrok http 4398 --url=<PLANNOTATOR_TEMPORARY_ORIGIN>`. | The bind address and the same peer check; neither is a setting. |
| one free loopback port per open Review page | `127.0.0.1` | Any process on this Mac, like the service port; the service is the only one told the port, and forwards `/plannotator/session/<review_id>/<rest>` to `/<rest>` there. The doors never reach it except through the service. | The bind address; `pages.ts` keeps the port to itself. |

Ports 4397, 4398 and 4399 are the live values; `PLANNOTATOR_SERVICE_PORT`, `PLANNOTATOR_TEMPORARY_PORT` and `PLANNOTATOR_PUBLIC_HOST`/`_PORT`/`_PEER` move them. Lavish runs its own ports beside them; the two services never share one.

- **Doors open only when their port is set.** `plannotator serve` opens a door only when `PLANNOTATOR_PUBLIC_PORT` or `PLANNOTATOR_TEMPORARY_PORT` is set to a port; unset or `off` opens none. Run by hand in a shell without them, a dev run never binds the Tailscale address or competes for 4398/4399; a shell that exports them opens those doors, so a dev shell keeps them unset. `plannotator service install` writes the live door settings (`LIVE_DOOR_SETTINGS` in `apps/hook/server/launch-agent.ts`) into the plist, under any setting the installing shell carries (`CARRIED_SETTINGS`).
- **The review API is never behind a door.** It lives at the site root (`/api/review/...`) and pages under `/plannotator/`, so Caddy's `/plannotator/*` route cannot expose it, and the doors refuse it again with 404 (`door-manifest.ts`). The listen socket and every WebSocket upgrade through a door answer 404.
- **A door serves only its Visibility, per request.** `visibilityOf` is read on every request; changing a Review's Visibility calls `revoke` on every door, closing its open requests (the Round stream included) at once. The service port serves every Review whatever its Visibility, since only this Mac reaches it.
- **A door answers only its hostnames.** `Host` and the last `X-Forwarded-Host` must be `ctas.de-appspecialist.nl` or the door's own address (public), or the host of `PLANNOTATOR_TEMPORARY_ORIGIN` (temporary); anything else is 404.
- **A door is rate-limited and never framed.** 300 requests per visitor per minute, keyed on the last `X-Forwarded-For` entry (the proxy's view), then 429 with `Retry-After`; every answer carries `frame-ancestors 'none'` and `x-frame-options: DENY`.
- **A door leaks no local paths.** Through a door `api/plan` keeps only the document's file name and drops `projectRoot`, `repoInfo` and `serverConfig.gitUser`; source save and the agent terminal are off. `api/plan/version(s)` take only the Review's own `v`, since upstream reads other documents from `path` and `base`.
- **A refused peer costs nothing.** The door is a `node:http` server, not `Bun.serve`, because only its `connection` event gives the peer address before any request is read; a socket from another address is destroyed there and logged once per minute per address.
- **A missing Tailscale address is not fatal.** A failed public bind is logged and retried every 30 seconds; the service port keeps serving.

## State

- **One process owns a reviews folder.** Each Review is a folder `<reviews dir>/<review_id>/` with `review.json`, `remarks.json`, `notices.json` and `replies.json`. The service holds all of them in memory and rewrites a file atomically (temporary file, then `rename`), one write per file at a time (`ReviewRecords.write`). Two services on one folder would overwrite each other, so a dev run uses its own `PLANNOTATOR_REVIEWS_DIR`.
- **A Review's id is derived, not secret.** It is the first 16 hex characters of the SHA-256 of the file's canonical path (symlinks resolved), so the same file always gets the same link. Knowing an id is not authority: a `local` Review's page answers only to processes on this Mac (the loopback service port), and a door checks Visibility.
- **Survives restarts.** The service loads every folder at start; a malformed `review.json` is skipped with one log line and left on disk. Remarks keep the listener sessions they reached (`delivered_to`), so a reconnect under the same session id does not replay them, while a new session receives every open Remark.
- **Nothing is lost while no one listens.** Send feedback stores its Remarks before it answers `{ "ok": true }`; Finish and Cancel notices stay `pending` until any listener acknowledges them. A subscription replays open Remarks, then pending notices, in store order, before `subscribed`.

## Rounds and the page

- **The service decides, not the page server.** Send feedback, Approve and Close (`api/feedback`, `api/approve`, `api/exit`) are answered by the service (ADR 0006); the upstream page server only gets the draft cleared first. A command for a Round that is not the open one writes nothing and answers 409, so a stale tab can never end the next Round.
- **The page server is upstream's.** One upstream annotate server per Review (ADR 0005), started on the first page request and kept while the service runs, so upstream's per-server state stays per Review. The page reaches its API through its own path (`page-base.ts`), and learns its Round from the Round stream and the `plannotator-review-round` meta tag (`page-round.ts`).
- **`plannotator annotate` is only a client.** On a local file it opens the Review with `reopen: true` and waits on the listen socket under its own session id (ADR 0007, `annotate-service.ts`); with no service it fails instead of falling back, so a stopped service is never hidden.

## Install and update

- **The installed binary is what runs.** `plannotator service install` copies the running compiled binary to `~/.local/bin/plannotator`, writes the plist with `PLANNOTATOR_SERVICE_LABEL`, replaces a loaded service and succeeds only when health answers with the binary's version and the label. A source run refuses to install. `fork/build-binary.ts` stamps the version with the fork commit (plus `.dirty.<stamp>` for an uncommitted checkout), so health tells which build serves.
- **Fork and plugin update together.** `omp-plannotator-review`'s `bun run setup` refuses a fork whose review API major it does not speak before it builds or restarts anything (`~/Work/prompts/update-plannotator.md`).
- **Fork code stays apart.** Fork code lives in `fork/` and fork-owned modules; upstream files get only small call sites (ADR 0003), and the root `README.md` gets only its pointer to `fork/README.md`.
