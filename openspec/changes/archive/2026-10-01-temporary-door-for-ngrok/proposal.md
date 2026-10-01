## Why

Owning intent: `/Users/codaveto/Brainspace/intents/das/own-plannotator-at-gates/own-plannotator-at-gates.md`. Story: `/Users/codaveto/Brainspace/intents/das/own-plannotator-at-gates/epic-plannotator-service/discovery.md#11`.

A Review can already be `temporary` and its link already names the ngrok host, but nothing listens on 4398, so the link answers ngrok's "endpoint offline" page. The LaunchAgent also runs the public door only because `plannotator serve` opens it by default, which means any `serve` run by hand binds the Tailscale address and the live port.

Pressure test: what if someone on the internet reaches 4398 directly? The door binds 127.0.0.1 and accepts only 127.0.0.1; neither is a setting. What if the tunnel is pointed at the door with another host name, or a local page calls `127.0.0.1:4398`? Only the host of `PLANNOTATOR_TEMPORARY_ORIGIN` is answered. What if a public Review's id is tried through ngrok? Visibility is read per request; only `temporary` is served. What if Brian runs `plannotator serve` while the LaunchAgent runs? Run by hand, serve opens no door, so it never fights the live service for 4398/4399.

## What Changes

- The temporary door: a second `startDoor` instance on `127.0.0.1:PLANNOTATOR_TEMPORARY_PORT` for peer `127.0.0.1`, serving only `temporary` Reviews, answering only the host of `PLANNOTATOR_TEMPORARY_ORIGIN`, with every rule of the public door (manifest incl. `api/review-round` and `api/review-replies`, per-request Visibility, rate limit, anti-framing, WebSockets 404, revoke on Visibility change).
- `PLANNOTATOR_TEMPORARY_ORIGIN` sets the origin of `temporary` links (default the fixed ngrok address) and is validated as a bare http(s) origin.
- A door opens only when its port is set. `plannotator serve` run by hand opens none.
- `plannotator service install` writes the live doors into the plist (public `100.111.186.85:4399` for `100.67.134.112`, temporary `4398`), overridable by the installing shell, and prints the doors it installed.

## Capabilities

### Modified Capabilities

- `review-service`: the temporary door; the LaunchAgent runs the live doors; serve by hand opens none.

## Impact

`packages/server/review-service/{settings,service,index,doors}.ts`, `doors.test.ts`, `service.test.ts`; `apps/hook/server/{serve-command,service-command,launch-agent}.ts`, `service-command.test.ts`; `docs/review-api.md`, `adr/0007-doors-serve-only-their-visibility.md`, `fork/README.md`.
