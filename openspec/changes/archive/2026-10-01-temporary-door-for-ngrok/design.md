## Context

Story 10 built `doors.ts` `startDoor` and the public door (ADR 0007), opened by default from `plannotator serve`. Lavish runs its two doors the other way: its server opens a door only when its port setting is set, and the LaunchAgent's `live` profile (`src/launch-agent.js`) carries the live ports. The temporary link origin and port constants (`DEFAULT_TEMPORARY_ORIGIN`, `TEMPORARY_PORT` = 4398) already exist in `routes.ts`.

## Goals / Non-Goals

**Goals:** temporary Reviews load through `ngrok http 4398`; the LaunchAgent runs both doors with the live values; `serve` run by hand is safe.

**Non-Goals:** starting or stopping ngrok (`madspec-tunnels`); a dev LaunchAgent profile.

## Decisions

- **Same door, second instance.** `startReviewService({ temporaryPort, temporaryOrigin })` calls `startDoor` with `visibility: "temporary"`, `host` and `peer` `127.0.0.1` (`TEMPORARY_DOOR_HOST`) and `hostnames` = the host of `temporaryOrigin`. All rules come from `startDoor` unchanged: manifest, per-request Visibility, rate limit keyed on the last `X-Forwarded-For` (ngrok appends the visitor), anti-framing, WebSocket 404, `revoke` on Visibility change.
- **Loopback is structural.** The temporary door's host and peer are constants, not settings, so no setting can face it outward. ngrok's agent on this Mac is its only client.
- **One host.** The temporary door answers only the host of `PLANNOTATOR_TEMPORARY_ORIGIN`, not its own `127.0.0.1:4398`: ngrok forwards the visitor's `Host` unchanged, and a page in a browser on this Mac cannot reach the door by its loopback address. The same setting sets the link, so link and door cannot disagree.
- **Origin setting is validated.** `PLANNOTATOR_TEMPORARY_ORIGIN` must be a bare `http`/`https` origin (a trailing slash is dropped); anything with a path, query or another scheme makes `serve` exit 2, since a wrong value would break every temporary link.
- **Doors open only when their port is set (`serve` by hand opens none).** Before, `serve` opened the public door on `100.111.186.85:4399` by default. A `serve` run by hand (a dev run, a test, a second service on another `--port`) would then bind the Tailscale address and race the LaunchAgent for 4399, or, with the temporary door, 4398, and expose whatever Reviews that dev store holds. Following Lavish, a door now opens only when `PLANNOTATOR_PUBLIC_PORT` / `PLANNOTATOR_TEMPORARY_PORT` is set; `off` still names "no door" explicitly. Host and peer of the public door keep their live defaults, so setting only the port gives the live door.
- **The LaunchAgent carries the live doors.** `servicePlan` writes `LIVE_DOOR_SETTINGS` (`PLANNOTATOR_PUBLIC_HOST=100.111.186.85`, `PLANNOTATOR_PUBLIC_PORT=4399`, `PLANNOTATOR_PUBLIC_PEER=100.67.134.112`, `PLANNOTATOR_TEMPORARY_PORT=4398`) into the plist, then the installing shell's `CARRIED_SETTINGS` over them, so `PLANNOTATOR_PUBLIC_PORT=off plannotator service install` installs without the public door. The temporary origin is not written: serve's default is the live ngrok address. Install prints the shell's carried settings and the resulting doors.

## Risks / Trade-offs

- [Someone relied on `serve` opening the public door by default] -> only the LaunchAgent did, and it now sets the port explicitly; the plugin's setup runs `service install`, which writes it.
- [ngrok's agent connects to `localhost`, which may resolve to `::1` first] -> the agent falls back to `127.0.0.1`; verified live with `ngrok http 4398`.
- [ngrok free plan shows an interstitial] -> clients send `ngrok-skip-browser-warning`; browsers see the warning once.
