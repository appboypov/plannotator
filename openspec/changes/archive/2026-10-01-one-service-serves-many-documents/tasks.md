## 1. Service module

- [x] 1.1 `packages/server/review-service/settings.ts`: `--port` over `PLANNOTATOR_SERVICE_PORT` over 4397, `PLANNOTATOR_REVIEWS_DIR` over `<data dir>/reviews`; verified by the settings tests in `service.test.ts`
- [x] 1.2 `store.ts`: `reviewIdForFile`, `ReviewStore` (load every folder, atomic `review.json` writes, skip unreadable state); verified by the restart and Visibility tests
- [x] 1.3 `pages.ts`: one upstream annotate server per Review, started once on first request, retried after a failed start, forwarding `/plannotator/session/<id>/<rest>` to `/<rest>`; verified by the page, single-start and 502 tests
- [x] 1.4 `service.ts`: version, health, open, list, Visibility, page routes and the Host and Origin rule; `index.ts` and the `./review-service` export in `packages/server/package.json`; verified by `bun test packages/server/review-service/service.test.ts` (11 pass) and `tsc --noEmit -p packages/server/tsconfig.json`

## 2. CLI

- [x] 2.1 `apps/hook/server/serve-command.ts`: usage, settings, loopback environment for pages, working directory, page start through `resolveAnnotateTarget` and `startAnnotateServer`; verified by the smoke run in 4.1
- [x] 2.2 Call sites: `serve` branch in `apps/hook/server/index.ts`, `serve` in `INTERNAL_SUBCOMMANDS`; verified by `bun test apps/hook/server/unknown-subcommand.test.ts apps/hook/server/plannotator-skill-reference.test.ts`

## 3. Docs and decision

- [x] 3.1 `docs/review-api.md` service section and stub lifetime; `fork/README.md` review service section
- [x] 3.2 `adr/0005-one-upstream-annotate-server-per-review.md`

## 4. Verification

- [x] 4.1 Smoke: `plannotator serve --port 4497` from source; two files give two ids, each `api/plan` returns its file, the first file again gives the same id, health 200, the page path serves the plan page, and both Reviews come back after a restart
- [x] 4.2 `openspec validate one-service-serves-many-documents --type change --strict` passes
