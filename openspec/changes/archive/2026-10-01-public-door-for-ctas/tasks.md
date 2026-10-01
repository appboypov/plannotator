## 1. Door

- [x] 1.1 `door-manifest.ts`: the routes a door passes; verified by `doors.test.ts`
- [x] 1.2 `doors.ts`: peer check, manifest, per-request Visibility, Host allowlist, rate limit, anti-framing, WebSocket refusal, revoke, bind retry, `api/plan` without local paths; verified by `doors.test.ts`
- [x] 1.3 `service.ts`: shared `health()` and `sessionRoute()`, `publicDoor` option, revoke on Visibility change, doors stopped; verified by `doors.test.ts`
- [x] 1.4 `settings.ts` and `serve-command.ts`: `PLANNOTATOR_PUBLIC_HOST`, `_PORT` (`off`), `_PEER`; verified by `service.test.ts` "service settings"

## 2. Docs and verify

- [x] 2.1 `docs/review-api.md` door section and ADR 0007
- [x] 2.2 Real verify from the VPS: health, public page 200, local 404, other peer dropped, ctas health and link 200
