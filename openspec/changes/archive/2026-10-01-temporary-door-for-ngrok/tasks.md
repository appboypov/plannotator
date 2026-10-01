## 1. Temporary door

- [x] 1.1 `settings.ts`: `PLANNOTATOR_TEMPORARY_PORT` (unset/`off` none), `PLANNOTATOR_TEMPORARY_ORIGIN` (bare http(s) origin); door ports open a door only when set; verified by `service.test.ts` "service settings"
- [x] 1.2 `service.ts`: `temporaryPort` starts `startDoor` on 127.0.0.1 for peer 127.0.0.1, visibility `temporary`, hostnames the origin's host; verified by `doors.test.ts` temporary door tests
- [x] 1.3 `serve-command.ts`: passes the temporary door and origin; usage names every door setting

## 2. Live doors under launchd

- [x] 2.1 `launch-agent.ts`: `LIVE_DOOR_SETTINGS` in the plist under the shell's carried settings; `service-command.ts` prints carried settings and doors; verified by `service-command.test.ts` "the LaunchAgent plist"

## 3. Docs and verify

- [x] 3.1 `docs/review-api.md` doors section, ADR 0007, `fork/README.md`
- [x] 3.2 Smoke from source: `serve --port 4497` by hand binds only 127.0.0.1:4497; with `PLANNOTATOR_TEMPORARY_PORT=4498` a temporary Review loads on 4498 with the ngrok Host, a public one gives 404
