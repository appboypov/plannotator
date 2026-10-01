## 1. Contract module

- [x] 1.1 `packages/shared/review-api/types.ts`: Review, Round, Remark, Reply, Visibility, every request, response and listen message; verified by `bun run typecheck`
- [x] 1.2 `version.ts` (`API_VERSION` 1.0), `routes.ts` (paths, ports, origins, `reviewLink`), `index.ts`; export `./review-api` in `packages/shared/package.json`; verified by `bun run typecheck`
- [x] 1.3 `parse.ts` request and listen-message parsers with `ERRORS`; `parse.test.ts` passes

## 2. Docs and decision

- [x] 2.1 `docs/review-api.md`: every route with request and response type, listen messages, stub usage; verified by reading the route table against `routes.ts`
- [x] 2.2 `adr/0004-review-api-v1-matches-lavish.md`

## 3. Stub

- [x] 3.1 `packages/server/review-api/stub.ts` answers every route and the listen socket; smoke: `GET /api/review/version` answers `{"major":1,"minor":0}`, and the unmodified `omp-lavish-review` `ReviewApi` client passes its major check, open, reply, visibility, list and cancel against it

## 4. Verification

- [x] 4.1 `bun run typecheck` passes
- [x] 4.2 `openspec validate review-api-v1-contract --type change --strict` passes
