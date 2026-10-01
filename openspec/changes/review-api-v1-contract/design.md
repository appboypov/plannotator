## Context

Story 2 of `epic-plannotator-service` writes the review API v1 contract so the service (1.3), the page (1.4), Remarks (1.5), Rounds (1.6), the CLI (1.7), Replies (1.8), both doors (1.10, 1.11) and the omp plugin (epic 2) can be built against one shape. The reference is Lavish's contract (`~/Repos/Forks/pew-pew-lavish/docs/review-api.md`, `src/review-api.js`) and its client (`~/Repos/Plugins/omp-lavish-review/src/review-api.ts`, `events.ts`, `types.ts`). Approach Part 2 puts the page under `/plannotator/session/<id>/` and health at `/plannotator/health`; Part 4 adds the `temporary` Visibility.

## Goals / Non-Goals

**Goals:**
- Types for every shape, route and listen message, importable by the server, the CLI and tests.
- `docs/review-api.md` listing every route with its request and response type.
- `API_VERSION` = `{ major: 1, minor: 0 }` on an unversioned `GET /api/review/version`.
- A stub that answers all of it, so the Lavish plugin client already works against it.

**Non-Goals:**
- The real service, storage, Rounds, doors, Host checks (stories 1.3 to 1.11).
- The page's own `api/*` routes beyond the Round refusal shape (story 1.4 and 1.6).

## Decisions

- **Wire names are Lavish's.** A Remark travels as `feedback_item` with an `fi_` id; open-Remark counts stay `open_item_count` / `open_items`; Approve is the `finish` notice. Types carry Plannotator's words (`Remark`, `RemarkEvent`, `OpenRemark`, `FinishNotice`). Alternative (renamed wire) rejected: every plugin parser would change for a word. Recorded as `adr/0004-review-api-v1-matches-lavish.md`.
- **Additive fields only.** `ReplyResponse.reply` (the stored `Reply`, id `rp_` + 24 hex) and `FinishNotice.notes` (the Approve's notes, `""` without) are Plannotator's additions; Lavish's client zod schemas strip unknown keys, proven by running its `ReviewApi` and `frameParser` against the stub.
- **Version route unversioned, answering `{ major, minor }`.** Lavish answers `{ major }`; the extra `minor` is additive. Decided in the yolo run (epic Change Log 2026-09-30).
- **Paths.** API at the site root (`/api/review/...`), page at `/plannotator/session/<id>/` (trailing slash, so the page's relative `api/...` calls resolve under it), health at `/plannotator/health`. The ctas rule for `/plannotator/*` therefore never reaches the API.
- **Ports.** 4397 service on 127.0.0.1, 4398 temporary door on 127.0.0.1, 4399 public door on the Tailscale address (`routes.ts`). Link origins: local `http://127.0.0.1:4397`, public `https://ctas.de-appspecialist.nl`, temporary `DEFAULT_TEMPORARY_ORIGIN` (the ngrok host) until story 1.11's setting names another.
- **Remark anchor for Markdown.** `selector` = annotated block id (`""` for a global comment), `tag` = annotation kind lowercase (`comment`, `deletion`, `global_comment`, from `AnnotationType`), `text` = the selected excerpt; Remark `text` = the comment, `""` for a deletion.
- **Open needs an absolute path.** Lavish resolves a relative path against the server's cwd; a launchd service has no meaningful cwd, so the contract refuses a relative `file` with 400 `file must be an absolute path` (the plugin and CLI send absolute paths).
- **Module placement (ADR 0003).** Fork-owned folder `packages/shared/review-api/` (types, version, routes, parse, index) exported as `@plannotator/shared/review-api` through one line in `packages/shared/package.json`; the stub in the fork-owned folder `packages/server/review-api/` so `bun run typecheck` (shared and server tsconfigs) covers both. `fork/` is outside every tsconfig.
- **Parsers are part of the contract.** `parse.ts` holds the request and listen-message checks and the error texts (`ERRORS`), so the stub and the service refuse with the same words. Unit tests cover them. It also holds `isLocalRequest`, Lavish's Host and Origin rule (403 `forbidden`), so the stub already refuses what the service will (local review finding).
- **Instrumentation.** The stub logs one start line to stderr, like upstream's CLI; no logging facade exists in the fork yet.

- **Local review (codex, gpt-6-sol).** Fixed: the stub's reopen gate for a finished Review, `answers: null` refused, Host and Origin rule, the stub page escapes the file path, the stub keeps subscriptions (list `listeners`) and delivers and replays Cancel notices. Declined: limiting `ack` to notices the socket received, because the contract (as in Lavish) lets any listener acknowledge any notice; the docs now say so.

## Risks / Trade-offs

- [The plugin copies `lavish-feedback` element names] -> epic 2 renames its message elements; the wire stays the same.
- [Stub diverges from the service] -> the stub imports the same parsers and types; story 1.3 deletes it when `plannotator serve` answers the same routes.

## Migration Plan

Not applicable: new files, no running system changes.

## Open Questions

None. ADR 0003 stays in force; ADR 0004 adds the wire decision.
