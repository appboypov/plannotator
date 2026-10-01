## Why

Owning intent: `/Users/codaveto/Brainspace/intents/das/own-plannotator-at-gates/own-plannotator-at-gates.md`. Story: `/Users/codaveto/Brainspace/intents/das/own-plannotator-at-gates/epic-plannotator-service/discovery.md#10`.

A client without access to this Mac cannot open a Review: the service binds 127.0.0.1 only. A Review marked `public` already carries the ctas link, and Caddy on the VPS already routes `https://ctas.de-appspecialist.nl/plannotator/*` to this Mac's Tailscale address on 4399, but nothing listens there.

Pressure test: what if a local Review's id is guessed? The door checks Visibility on every request and answers 404 unless it is `public`. What if someone on the tailnet other than the VPS connects? The socket is dropped before a byte is read. What if a visitor calls the review API through ctas? The door's manifest lists only health and the page's own routes; everything else is 404. What if the Review is made local while a client keeps its page open? Its open streams through the door close at once. What if Tailscale is not up when the service starts? The bind is retried every 30 seconds.

## What Changes

- A public door: a second listener (default `100.111.186.85:4399`) that accepts only the VPS (`100.67.134.112`) and serves `/plannotator/health` plus the page routes of `public` Reviews, with Lavish's door rules (manifest, per-request Visibility, Host allowlist, rate limit, anti-framing, WebSockets refused, revoke on Visibility change).
- The page's `api/plan` through a door drops this Mac's paths, repo, git user, source save and agent terminal.
- `plannotator serve` starts it from `PLANNOTATOR_PUBLIC_HOST`, `PLANNOTATOR_PUBLIC_PORT` (`off` disables) and `PLANNOTATOR_PUBLIC_PEER`.
- ADR 0007 records the door design; story 11's temporary door reuses it.

## Capabilities

### Modified Capabilities

- `review-service`: the public door.

## Impact

New `packages/server/review-service/{doors,door-manifest}.ts` and `doors.test.ts`; `service.ts` (health shared, session route shared, revoke on Visibility change, doors stopped), `settings.ts`, `index.ts`, `apps/hook/server/serve-command.ts`, `docs/review-api.md`, `adr/0007-doors-serve-only-their-visibility.md`.
