## Context

Story 5 of `epic-plannotator-service`. The service (story 3, ADR 0005) forwards each Review's page to its own upstream annotate server; story 4 makes the page call its API under its link. The contract (`docs/review-api.md`, `packages/shared/review-api/`, ADR 0004) defines Remarks, the listen socket and the list's open items; Lavish (`pew-pew-lavish/src/review-api.js`, `review-listeners.js`) is the reference.

## Goals / Non-Goals

**Goals:** Send feedback stores one Remark per annotation; a listener that connects later receives every Remark no listener session has taken; a reconnect does not deliver them again; the list counts open Remarks and listeners.

**Non-Goals:** Approve, Rounds, Cancel and notices (story 1.6); Replies (story 1.8); the doors (stories 1.10, 1.11).

## Decisions

- **The service answers `api/feedback` itself** (ADR 0006). Upstream's page server settles one decision per server, so a second send would be refused, and its decision holds formatted text. The service parses upstream's body, maps each `annotations` entry to a Remark (`text` from `text`, anchor `selector` from `blockId`, `tag` from lowercase `type`, `text` from `originalText`, each `""` when missing), first forwards `DELETE api/draft?generation=<draftGeneration>` to the page server as upstream's own route does (when that fails it answers 502 and stores nothing, so a reload cannot bring back annotations that are already Remarks), then stores them, sends them and answers `{ "ok": true }`. The formatted `feedback` and `codeAnnotations` are not Remarks.
- **Remarks live in `<review folder>/remarks.json`** as `{ remarks: StoredRemark[] }`; a `StoredRemark` is the contract's `Remark` plus `at`, `status` (`open` | `answered`, for story 1.8) and `delivered_to` (session ids). `RemarkStore` keeps them in memory, applies changes at once and writes each Review's file atomically (temp file and rename), one write after another. An unreadable file is logged and skipped, like an unreadable `review.json`.
- **Delivery once per session, stored.** `ReviewListeners.deliver` sends a Remark to a socket only when it is open, its `delivered_to` lacks the session and the socket's own `sent` set lacks it, and records the session only when the socket took the frame (Bun's `send` answers 0 on a closing socket). A reconnect, even after a restart, gets nothing old; a new session gets every open Remark. This refines the contract's "except to a connection that already received it" to "session"; the plugin builder was told.
- **Socket shape as the stub and Lavish.** Handshake on the service's `fetch`: Host and Origin check, 400 `session required`, `server.upgrade`. One socket per session, the old one closed with 1000. Subscribe replays the Reviews the subscription adds, then announces overlapping listeners both ways, then `subscribed`. `page_open` goes out where the page load sets `last_page_open`. `ack` answers `unknown notice` until story 1.6 stores notices.
- **Frame limit enforced by the service.** Bun drops a frame over its own `maxPayloadLength` without a close code, so Bun's limit is 1 MiB and the message handler closes a frame over 64 KiB with 1009.
- **Heartbeat by the service.** Bun's own idle close and pings are off; every 30 seconds the service pings each listener and terminates one that left the previous ping unanswered.

## Risks / Trade-offs

- A listener that drops a Remark before handing it over does not get it again under the same session. The plugin hands each frame over synchronously and follows under a new session id.
- `delivered_to` grows with each session that listens; sessions are few per Review.
