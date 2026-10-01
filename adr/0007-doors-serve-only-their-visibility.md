# 7. Doors serve only their Visibility

Date: 2026-10-01

## Status

Accepted

## Context

The service listens on 127.0.0.1 and answers only this Mac (ADR 0004). A Review's Visibility (`public`, `temporary`) promises its page to clients elsewhere: through `https://ctas.de-appspecialist.nl`, where Caddy on the VPS routes `/plannotator/*` over Tailscale to this Mac, and through an ngrok tunnel. Opening the service itself to those clients would expose the review API, the listen socket and every upstream page route that reads this Mac's disk. Lavish solved the same problem with a door per Visibility (its ADR 0008).

## Decision

- Each Visibility other than `local` gets its own door: a second listener (`packages/server/review-service/doors.ts`) on its own address and port that accepts one peer and drops every other socket on connect.
- A door serves only what `door-manifest.ts` lists: `/plannotator/health` and the page routes of a Review whose Visibility is the door's, read at request time. Everything else, the review API and every WebSocket included, answers 404.
- A door answers only its hostnames, rate-limits each visitor, forbids framing, and closes a Review's open requests when its Visibility changes away.
- A door hands allowed requests to the service's own session route in-process, so pages behave the same through every door; the page's `api/plan` loses this Mac's paths on the way out.
- The public door binds `100.111.186.85:4399` for peer `100.67.134.112` and retries a failed bind every 30 seconds.
- The temporary door binds `127.0.0.1:4398` for peer `127.0.0.1` (ngrok's agent on this Mac) and answers only the host of `PLANNOTATOR_TEMPORARY_ORIGIN`, the origin of `temporary` links; its address and peer are not settings, so it can never face anything but loopback.
- A door opens only when its port is set: the LaunchAgent sets the live ports; `plannotator serve` run by hand opens none, so a dev run never binds the Tailscale address or claims a live port.

## Consequences

- A guessed id of a local Review, the review API and the disk-reading page routes are never reachable from outside.
- Page features whose routes the manifest omits (file browser, linked documents, images from disk, AI, agent terminal) are off through a door.
- Adding a page route the client must reach means adding it to the manifest, with a test.
