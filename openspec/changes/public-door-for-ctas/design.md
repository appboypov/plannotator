## Context

The service (ADR 0005, 0006) listens on 127.0.0.1 and refuses foreign hosts (`isLocalRequest`). Visibility and the ctas link exist since the contract; the door that makes them real is missing. Lavish's public listener (`src/public-listener.js`, its ADR 0008) is the reference.

## Goals / Non-Goals

**Goals:** serve public Reviews through ctas with the same rules as Lavish; no route other than the page's own reachable; live default needs no settings.

**Non-Goals:** the temporary door (story 11 adds a second instance of the same door); launchd wiring (story 12).

## Decisions

- **One door module, many doors.** `doors.ts` `startDoor({ visibility, host, port, peer, hostnames, visibilityOf, health, page })`. Story 11 starts it a second time with `temporary`, loopback and the ngrok host.
- **`node:http`, not `Bun.serve`.** Only its `connection` event gives the peer's address before any request is read; a socket from another address is destroyed there, and each refused address is logged once per window.
- **Manifest.** `door-manifest.ts` lists health and, under `/plannotator/session/<id>`, the page's HTML, favicon, `api/plan` (+ versions), `api/draft`, `api/feedback`, `api/approve`, `api/exit`, `api/review-round`, `api/review-replies` and the client lease stream, each with its methods. Everything else is 404: the review API, the listen socket, file and image routes, source save, settings, AI and the agent terminal. Every WebSocket upgrade is answered 404.
- **The door calls the service in-process.** An allowed request becomes a `Request` to the same `sessionRoute` the local service uses (page commands, Round stream, Replies, proxy to the page server), so the page behaves the same through every door. Responses stream through unbuffered, so the Round stream and its 25 s keepalive reach the client.
- **Visibility per request.** `visibilityOf(id)` reads the store on every request. `setVisibility` calls `door.revoke(id, visibility)` after its save; the door destroys its open responses for that Review unless the new Visibility is its own.
- **Host allowlist.** `Host` and the last `X-Forwarded-Host` must be `ctas.de-appspecialist.nl` or the door's own address.
- **Rate limit.** 300 requests per visitor per 60 s window, keyed on the last `X-Forwarded-For` entry (Caddy appends the client) or the socket address; over it 429 with `Retry-After`.
- **Anti-framing.** Every door answer carries `content-security-policy: frame-ancestors 'none'` and `x-frame-options: DENY`.
- **No local paths.** The door rewrites `api/plan`: `filePath`/`sourceInfo` become the file name; `projectRoot`, `repoInfo`, `serverConfig.gitUser` go; `sourceSave` and `agentTerminal` are disabled.
- **Bind retry.** A failed bind is logged and retried every 30 s, so the service starts before Tailscale is up.
- **Settings.** `PLANNOTATOR_PUBLIC_HOST` (100.111.186.85), `PLANNOTATOR_PUBLIC_PORT` (4399, `off`), `PLANNOTATOR_PUBLIC_PEER` (100.67.134.112).

## Risks / Trade-offs

- [The page calls a route the manifest lacks] -> that feature is off through the door (404) but the page still loads; the manifest grows with a test when a route is needed.
- [Upstream renames page routes] -> the manifest test and the real verify through ctas catch it.
