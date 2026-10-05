# Review API (v1)

The fork's always-on review service (`plannotator serve`, port 4397 on `127.0.0.1`) exposes the review API over HTTP and a WebSocket listen socket. It is Lavish's review API v1 (`~/Repos/Forks/pew-pew-lavish/docs/review-api.md`) with the same JSON field names, so a plugin written for Lavish (`~/Repos/Plugins/omp-lavish-review`) reads it unchanged. Check the major version before using v1.

The types live in `packages/shared/review-api/` (import `@plannotator/shared/review-api`): `types.ts` for every shape named below, `version.ts` for `API_VERSION`, `routes.ts` for paths, ports and links, `parse.ts` for the request and message checks and their error texts. ADR `adr/0004-review-api-v1-matches-lavish.md` records why.

## Words

- **Review**: one document or pull/merge request's lasting link and state. Its id is 16 lowercase hex characters and stays the same when the same canonical subject is opened again.
- **Round**: a numbered pass over a Review, starting at 1. Approve finishes it, Cancel cancels it, reopening starts the next Round on the same link and fetches a PR's current head.
- **Remark**: one annotation the reviewer sent with Send feedback. On the wire it is a `feedback_item` with an `fi_` id, as in Lavish.
- **Reply**: an agent's answer, shown on the page beside the Remarks it answers.
- **Visibility**: who can open the page. `local` (this Mac), `public` (anyone with the link, through `https://ctas.de-appspecialist.nl`) or `temporary` (anyone with the link, through the ngrok host).

## Routes

| Method | Path | Request | Response (HTTP 200) |
|---|---|---|---|
| `GET` | `/api/review/version` | none | `ApiVersion` |
| `POST` | `/api/review/v1/reviews` | `OpenReviewRequest` | `OpenReviewResponse` |
| `GET` | `/api/review/v1/reviews[?file=<absolute path or PR URL>]` | `ListReviewsQuery` | `ListReviewsResponse` |
| `POST` | `/api/review/v1/reviews/:review_id/replies` | `ReplyRequest` | `ReplyResponse` |
| `POST` | `/api/review/v1/reviews/:review_id/cancel` | none | `CancelReviewResponse` |
| `POST` | `/api/review/v1/reviews/:review_id/visibility` | `VisibilityRequest` | `VisibilityResponse` |
| `GET` (WebSocket) | `/api/review/v1/listen?session=<omp session id>` | `ListenClientMessage` frames | `ListenServerMessage` frames |
| `GET` | `/plannotator/health` | none | `HealthResponse` |
| `GET` | `/plannotator/session/:review_id/` | none | the Review page (HTML) |
| `GET` | `/plannotator/session/:review_id/api/review-replies` | none | `ReviewRepliesResponse` |

Every refused request answers JSON `ErrorResponse` (`{ "error": "…" }`), except a Reply naming unknown Remarks (`UnknownRemarksResponse`) and the listen handshake's 400 `session required`, which is plain text. Malformed JSON gets HTTP 400. An unknown `review_id` gets HTTP 404 `{ "error": "review not found" }`. The error texts are `ERRORS` in `parse.ts`.

As in Lavish, the service answers only its own hosts (`127.0.0.1`, `localhost`, on its port) and refuses others with HTTP 403 `{ "error": "forbidden" }`; a `POST` or listen handshake with a present foreign `Origin` or `Referer` gets the same 403. Header-less local clients, such as the plugin and the CLI, may call every route. The check is `isLocalRequest` in `parse.ts`; the doors (see "The doors") have their own rules.

The review API lives at the site root and the page under `/plannotator/`, so the public door on ctas (`/plannotator/*`) never exposes the API.

## Version

`GET /api/review/version` returns HTTP 200 with `ApiVersion`:

```json
{ "major": 1, "minor": 2 }
```

The route is unversioned, so a client can read any major. A client that supports a different `major` must not open, listen or write. `minor` grows with changes a client may ignore: a new field, or a server message it no longer receives (ADR 0008). The constant is `API_VERSION`.

## Health

`GET /plannotator/health` returns HTTP 200 with `HealthResponse` while the service runs:

```json
{ "ok": true, "app": "plannotator", "version": "0.27.23", "api": { "major": 1, "minor": 2 } }
```

`version` is the fork build version, such as `0.27.23-appboypov.da228139`. When launchd runs the service (`plannotator service install`), health adds `"service": { "label": "nl.de-appspecialist.plannotator" }`.

## Open a Review

`POST /api/review/v1/reviews` with `OpenReviewRequest`:

```json
{ "file": "/absolute/path/to/plan.md", "reopen": false, "visibility": "local" }
```

- `file` (string, required): an absolute path to an existing file on this Mac, or a pull/merge request URL accepted by upstream `parsePRUrl` (GitHub, GitLab or Bitbucket Cloud). PR URLs normalize to their canonical platform URL: `/files`, trailing slash and other accepted suffixes identify the same Review. Open checks URL shape only, without authentication or network access. Authentication and PR fetching happen on the first page request.
- `reopen` (boolean, optional): reopen a Review the reviewer finished with Approve. A cancelled Review reopens without it.
- `visibility` (`"local" | "public" | "temporary"`, optional): a new Review opens `local` when none is named; an open without it keeps an existing Review's Visibility.

HTTP 200 with `OpenReviewResponse`:

```json
{
  "review_id": "0123456789abcdef",
  "link": "http://127.0.0.1:4397/plannotator/session/0123456789abcdef/",
  "status": "opened",
  "round": 1,
  "visibility": "local"
}
```

- `status` is `opened`, or `user-ended` when the reviewer finished the Review and `reopen` was not set: nothing was written and `round` is the Round that ended.
- Opening an ended Review reopens it into the next Round on the same `review_id` and `link`; opening an open Review changes nothing and returns its current Round.
- `link` is the Review's page for its Visibility (`reviewLink` in `routes.ts`): the path is always `/plannotator/session/<review_id>/`, the origin is `http://127.0.0.1:4397` for `local`, `https://ctas.de-appspecialist.nl` for `public` and the ngrok host for `temporary`.

Errors: absent or blank `file` 400 `file path required`; a relative `file` 400 `file must be an absolute path`; a `reopen` that is not a boolean 400 `reopen must be a boolean`; a `visibility` outside the three 400 `visibility must be local, public or temporary`; a missing file 404 with an `error` naming it. None creates a Review.

An unsupported HTTP(S) URL answers 400 with `Invalid PR/MR URL: <the URL>` and creates no Review. A PR's `review_id` is 16 random hex characters made when its Review is first opened; every later open of any form of its URL returns it. For example `{"file":"https://github.com/appboypov/plannotator/pull/22/files","visibility":"public"}` opens the Review for `https://github.com/appboypov/plannotator/pull/22`. `reopen`, Visibility, Replies and Cancel use the same routes and lifecycle for both subjects.

## List Reviews

`GET /api/review/v1/reviews` returns HTTP 200 with `ListReviewsResponse`, every Review sorted by `file`:

```json
{
  "reviews": [
    {
      "review_id": "0123456789abcdef",
      "link": "https://ctas.de-appspecialist.nl/plannotator/session/0123456789abcdef/",
      "file": "/absolute/path/to/plan.md",
      "visibility": "public",
      "state": "open",
      "round": 2,
      "round_opened_at": "2026-10-01T09:00:00.000Z",
      "open_item_count": 1,
      "last_page_open": "2026-10-01T09:30:00.000Z",
      "listeners": ["omp-session-1"]
    }
  ]
}
```

Each entry is a `Review`: a `Round` (`review_id`, `round`, `state` of `open`, `finished` or `cancelled`) plus its link, canonical subject in `file` (absolute path or PR URL), Visibility, when the Round opened, how many Remarks are open across all Rounds, when the page was last loaded, and the sessions in its line (see "One listener holds each Review"), the one that holds it first.

With `?file=<absolute path or PR URL>` (`ListReviewsQuery`) the list holds only that subject's Review, and the entry adds `open_items`: its open Remarks as `OpenRemark` (a `Remark` plus `at`, when it was stored), in store order. PR URLs canonicalize through upstream `parsePRUrl` exactly as open does, so an agent's `/files` URL finds the canonical Review. Paths keep their existing symlink resolution. A subject never opened lists `{ "reviews": [] }`. A blank or relative `file` gets 400 `file must be an absolute path`; an unsupported HTTP(S) URL gets 400 naming it. The list writes nothing and fetches no PR.

## Reply to a Review

`POST /api/review/v1/reviews/:review_id/replies` with `ReplyRequest`:

```json
{ "text": "Tightened the heading.", "answers": ["fi_0123456789abcdef01234567"] }
```

- `text` (string, required): the Reply, with at least one non-whitespace character.
- `answers` (string array, optional, default `[]`): the Remarks of this Review it answers, from any Round. A duplicate id counts once.

HTTP 200 with `ReplyResponse`:

```json
{
  "status": "sent",
  "answered": ["fi_0123456789abcdef01234567"],
  "reply": {
    "id": "rp_0123456789abcdef01234567",
    "review_id": "0123456789abcdef",
    "text": "Tightened the heading.",
    "answers": ["fi_0123456789abcdef01234567"],
    "at": "2026-10-01T09:40:00.000Z"
  }
}
```

`reply` (a `Reply`) is Plannotator's addition; Lavish clients ignore it. Each answered Remark stops being replayed; a Reply leaves every Remark it does not name open. A Reply on an ended Review is allowed. No listen event is sent for a Reply. The Reply is stored in the Review's folder and the Review page shows it (`<link>api/review-replies`, below).

Errors, each writing nothing: blank or missing `text` 400 `reply text required`; `answers` not a string array 400 `answers must be an array of Feedback item ids`; any named id that is not a Remark of this Review 400 `UnknownRemarksResponse`:

```json
{ "error": "unknown feedback items", "unknown": ["fi_…"] }
```

## Cancel a Review

`POST /api/review/v1/reviews/:review_id/cancel` (no body) ends the current Round for its agent: it stores a Cancel notice, the page goes read-only and listeners receive `cancel`. Cancelling an ended Review writes nothing and reports how it ended. HTTP 200 with `CancelReviewResponse`:

```json
{ "review_id": "0123456789abcdef", "state": "cancelled", "round": 1 }
```

`state` is `cancelled`, or `finished` when the reviewer had already approved the Round. Reopen with the open call.

## Change a Review's Visibility

`POST /api/review/v1/reviews/:review_id/visibility` with `VisibilityRequest` `{ "visibility": "temporary" }` sets the Visibility at any time, open or ended, and changes nothing else. HTTP 200 with `VisibilityResponse`:

```json
{
  "review_id": "0123456789abcdef",
  "visibility": "temporary",
  "link": "https://knowledgeably-supersweet-kizzie.ngrok-free.dev/plannotator/session/0123456789abcdef/"
}
```

A `visibility` outside the three gets 400 `visibility must be local, public or temporary`. No listen event is sent.

## The page's Round-checked commands

The Review page calls its API relative to its own path (`/plannotator/session/<review_id>/api/...`); those are upstream Plannotator's page routes, not part of v1. Two of them close or feed a Round and accept an optional integer `round` in their JSON body, the Round the page shows: Send feedback (`api/feedback`) and Approve (`api/approve`). A command whose `round` is not the Review's current open Round writes nothing and answers HTTP 409 with a `RoundRefusal`:

A PR page sends Approve to `api/feedback` with `approved: true`; the service finishes its Round with `feedback` as notes and stores no annotation Remarks. With `approved` false or absent it stores feedback Remarks. `api/exit` finishes with `dismissed: true`, taking `round` and `draftGeneration` in its query. These commands clear the sent draft before storage and use the same Round refusals.

```json
{ "status": "stale-round", "error": "round 1 is not open; the Review is in round 2", "round": 2 }
```

```json
{ "status": "ended", "error": "round 2 has ended", "round": 2, "state": "finished", "ended_by": "user" }
```

`StaleRoundResponse` when `round` is not the current Round; `EndedRoundResponse` when the current Round has ended, with `state` (`finished` or `cancelled`) and `ended_by` (`user` or `agent`). A `round` that is not a positive integer gets 400 `round must be a positive integer`. The page turns read-only on either 409.

The page covers itself when its Round is over, from the Round stream or from a 409: `Round N is finished`, `Round N was cancelled`, or `Round N is open` with a button that reloads into the new Round. A reload of an ended Round shows the same cover. When the next Round opens, an ended Round's cover gives way to `Round N+1 is open`. The tab that approves keeps upstream's completion screen until the next Round opens.

## The page's Remarks and Replies

`GET /plannotator/session/<review_id>/api/review-replies` (`PAGE_REPLIES_PATH`, relative to the page: `<link>api/review-replies`) answers the page, open or ended, with HTTP 200 and `ReviewRepliesResponse`: every Remark of every Round in store order, each with its `at`, `status` and the Replies that name it in the order they were sent, then the Replies that name no Remark:

```json
{
  "review_id": "0123456789abcdef",
  "remarks": [
    {
      "id": "fi_0123456789abcdef01234567",
      "review_id": "0123456789abcdef",
      "round": 1,
      "text": "Tighten the heading.",
      "anchor": { "selector": "block-3", "tag": "comment", "text": "Draft heading" },
      "at": "2026-10-01T09:30:00.000Z",
      "status": "answered",
      "replies": [
        {
          "id": "rp_0123456789abcdef01234567",
          "review_id": "0123456789abcdef",
          "text": "Tightened the heading.",
          "answers": ["fi_0123456789abcdef01234567"],
          "at": "2026-10-01T09:40:00.000Z"
        }
      ]
    }
  ],
  "replies": []
}
```

A `PageRemark` is a `Remark` with `at`, `status` (`open` or `answered`) and `replies`. It is a page route like the Round stream: the service answers it, the page server never sees it, and it carries no listener data. An unknown `review_id` gets 404 `review not found`.

The page reads this route each time its annotation panel opens and lists the Remarks under a "Sent" divider below the draft: each Remark read-only and stamped with its Round, each Reply under every Remark it answers, labelled "Reply" from "Agent", and the Replies that answer no Remark last. Sent Remarks never join the draft, so Send feedback and Approve do not send them again. A failed read logs and shows no "Sent" section.

## Listen to Reviews

Connect a WebSocket to `/api/review/v1/listen?session=<omp session id>` on the local service. A missing or blank `session` gets HTTP 400 `session required` during the handshake. A second socket with the same session id replaces the first (the old one closes with code 1000) and starts subscribed to nothing. Every frame is one UTF-8 JSON text frame; a client frame over 64 KiB closes the socket (1009).

### One listener holds each Review

Each Review has a line of the listeners whose subscription includes it: first the listeners whose subscription names the Review, in the order they started naming it, then the listeners subscribed to `"all"`, in the order they subscribed to all. A listener keeps its place while each later subscription keeps the Review the same way (named, or under `"all"`); a new socket joins the back of its group, also when it replaces a socket of the same session. The first listener in the line holds the Review: its Remarks, Finish notices and Cancel notices go to the holder only.

The holder changes when it leaves the line (its socket closes or is replaced, the heartbeat drops it, or its subscription no longer includes the Review), when a later subscription keeps the Review another way and so puts it behind another listener, and when a listener that names the Review joins ahead of a holder subscribed to all. The new holder then first receives the Review's backlog it has not received: open Remarks its session has not received and pending notices its socket has not received, in store order; live events follow. So a session subscribed to all receives every Review no session names, and takes a Review back with its unanswered Remarks and its unacknowledged notices when the session that named it leaves.

The line holds every listener, so `listeners` in the list and the page's presence count them all; only the holder receives the Review's events. `plannotator annotate` names its Review too: a call on a file another session named first waits behind that session.

### Client messages (`ListenClientMessage`)

- `SubscribeMessage` `{ "type": "subscribe", "reviews": "all" | ["<review_id>", …] }`: replaces the subscription. Duplicate ids count once; an unknown id is heard once that Review exists; `[]` stops listening and keeps the socket open. The server first replays the backlog of every Review the listener holds after the subscription and did not hold before (open Remarks, then pending notices, in store order), then confirms with `subscribed`. A Review the listener keeps holding is not replayed again, and a Review another listener holds is not replayed to it.
- `AckMessage` `{ "type": "ack", "id": "nt_…" }`: acknowledges a Finish or Cancel notice so no later subscription replays it. A successful ack sends nothing back; acknowledging an acknowledged notice again changes nothing. As in Lavish, any listener may acknowledge any notice. Remarks are not acknowledged; they stay open until a Reply answers them.

### Server messages (`ListenServerMessage`)

`RemarkEvent`, one per Remark, live or replayed:

```json
{
  "type": "feedback_item",
  "id": "fi_0123456789abcdef01234567",
  "review_id": "0123456789abcdef",
  "round": 1,
  "text": "Tighten the heading",
  "anchor": { "selector": "block-3", "tag": "comment", "text": "Draft heading" }
}
```

- `id`: `fi_` plus 24 lowercase hex characters, unique across Reviews and kept across restarts.
- `text`: the reviewer's words; `""` for an annotation without words, such as a deletion.
- `anchor` (`RemarkAnchor`): `selector` is the annotated block's id (`""` for a global comment), `tag` the annotation kind lowercase (`comment`, `deletion`, `global_comment`), `text` the annotated excerpt. Each is `""` when the page sent none.
- `feedback` (Plannotator's addition, absent when the page sent no text): the page's whole Send feedback text the Remark came with, upstream's agent-facing markdown, which also holds what is not a Remark (question answers, images, code annotations). Every Remark of one Send feedback carries the same text.

For code annotations, `anchor.selector` is `<filePath>:<lineStart>` or `<filePath>:<lineStart>-<lineEnd>`; a file-scope annotation uses just `<filePath>`. An annotation with general scope or an empty file path uses selector `""` and tag `global_comment`. Other annotations use the lowercase annotation type as `anchor.tag`. `anchor.text` is the first present `originalCode`, `selectedText` or `tokenText`, or `""`. `text` holds the comment and appends `suggestedCode` in a fenced block when present, including an empty suggestion that removes the annotated code. A send with only general `feedback` creates one `global_comment`. Every Remark retains the whole `feedback` text. The code review UI does not list sent Remarks or Replies.

An open Remark reaches each listener session once: it goes to its Review's holder, and is replayed to each next holder until a Reply answers it, except to a session that already received it, on this socket or an earlier one. The service stores which sessions received each Remark, so a reconnect under the same session id, even after a restart, does not bring it back. A listener that must not lose a Remark hands it over before it acts on the next frame.

`Notice`, stored and replayed to each next holder until acknowledged:

```json
{ "type": "finish", "id": "nt_0123456789abcdef01234567", "review_id": "0123456789abcdef", "round": 1, "at": "2026-10-01T10:00:00.000Z", "notes": "Ship it." }
```

```json
{ "type": "cancel", "id": "nt_0123456789abcdef01234567", "review_id": "0123456789abcdef", "round": 1, "at": "2026-10-01T10:00:00.000Z" }
```

`FinishNotice` is the reviewer's Approve or Close; `notes` (Plannotator's addition) carries the Approve's notes, `""` without notes or for Close, and `dismissed: true` (Plannotator's addition, absent on Approve) marks a Close. `CancelNotice` is an agent's Cancel. `round` is the Round the notice closed. A Send feedback's Remarks arrive before a Finish written after them.

Replies to the client's own messages:

- `SubscribedMessage` `{ "type": "subscribed", "reviews": "all" | ["…"] }`: the normalized subscription, after its replay.
- `ListenErrorMessage` `{ "type": "error", "error": "…" }`: a frame that is not a JSON `subscribe` or `ack`, a `subscribe` whose `reviews` is neither `"all"` nor an array of nonblank ids, an `ack` without an id, or an `ack` of an id that is not a notice (`unknown notice nt_…`). Nothing changes and the socket stays open.

### Liveness

The server pings every 30 seconds and drops a listener that did not answer the previous ping; the Reviews it held go to the next listener in their lines. While a Review's line holds a listener, its page shows the agent as listening.

## The doors

A door is a second listener that lets clients elsewhere open the pages of Reviews with its Visibility, and nothing else (ADR 0007, `packages/server/review-service/doors.ts`).

- **The public door** serves `public` Reviews for `https://ctas.de-appspecialist.nl`, where Caddy on the VPS routes `/plannotator/*` over Tailscale to it. It binds `PLANNOTATOR_PUBLIC_HOST`:`PLANNOTATOR_PUBLIC_PORT` (host default `100.111.186.85`) and accepts only `PLANNOTATOR_PUBLIC_PEER` (default the VPS, `100.67.134.112`). A failed bind (Tailscale not up yet) is logged and retried every 30 seconds.
- **The temporary door** serves `temporary` Reviews for the ngrok tunnel (`ngrok http 4398 --url=<origin>`). It binds `127.0.0.1:PLANNOTATOR_TEMPORARY_PORT` and accepts only `127.0.0.1`, ngrok's agent on this Mac; neither is a setting. `PLANNOTATOR_TEMPORARY_ORIGIN` (an http or https origin, default `https://knowledgeably-supersweet-kizzie.ngrok-free.dev`) is the origin of `temporary` links and the one host the door answers. ngrok's free plan shows a warning page unless the client sends `ngrok-skip-browser-warning`.
- **Which doors open:** a door opens only when its port is set; `off` or unset opens none. `plannotator serve` run by hand opens no door. The LaunchAgent (`plannotator service install`) runs the live doors, public `100.111.186.85:4399` for `100.67.134.112` and temporary `127.0.0.1:4398`, unless the installing shell names other settings.
- **Peer:** a socket from any other address is destroyed on connect, before a byte is read; each refused address is logged once per minute.
- **Manifest** (`door-manifest.ts`): `GET|HEAD /plannotator/health` and, under `/plannotator/session/<review_id>`, the page itself (`""` redirects to `/`), favicon, plan and version reads, draft (`GET|POST|DELETE`, optional `generation`), feedback/approve/exit (`POST`), Round stream, Replies and annotate client lease (`GET`). For PR subjects it also serves `GET api/diff`, `api/diff/fresh` (`snapshot`), `api/pr-context`, `api/file-content` (`path`, `oldPath`, `snapshot`) and `api/review-image` (`path`, `side`, `snapshot`). These PR reads refuse local file Reviews. Everything outside the manifest answers 404, including the review API, listen socket, local images/documents, `api/pr-action`, `api/pr-viewed`, staging, open-in, agents/AI, config, upload, code navigation and PR/worktree switching. Every WebSocket upgrade answers 404.
- **Live PR context:** `GET api/pr-context/stream` is also a PR-only door read, with no query parameters. The code review page uses this SSE stream for comments, checks and merge status.
- **Visibility per request:** a page route answers 404 unless the Review's Visibility is the door's at that moment. Changing a Review's Visibility away from the door's closes its open requests through the door, such as the Round stream.
- **Hosts:** `Host` and the last `X-Forwarded-Host` must be one of the door's hostnames, else 404: for the public door `ctas.de-appspecialist.nl` or the door's own address, for the temporary door only the host of `PLANNOTATOR_TEMPORARY_ORIGIN`.
- **Rate limit:** 300 requests per visitor per minute, keyed on the last `X-Forwarded-For` entry (else the socket address); over it HTTP 429 with `Retry-After`.
- **Framing:** every answer carries `content-security-policy: frame-ancestors 'none'` and `x-frame-options: DENY`.
- **No local paths:** through a door, `api/plan` gives `filePath` and `sourceInfo` as the file name, drops `projectRoot`, `repoInfo` and `serverConfig.gitUser`, and turns off source save and the agent terminal. PR diff and freshness responses drop `agentCwd`, `gitContext`, `repoInfo`, `aiReviewContext`, `platformUser` and `serverConfig.gitUser`, and advertise AI as disabled.
- The door answers allowed routes with the service's own handlers (health, page commands, Round stream, Replies, the page server), streamed unbuffered.

## The service

`plannotator serve` runs the service (`packages/server/review-service/`, `@plannotator/server/review-service`):

```sh
plannotator serve [--port <n>]   # 127.0.0.1:4397; --port, else PLANNOTATOR_SERVICE_PORT; 0 picks a free port
```

- Each Review's state lives in its own folder, `<reviews dir>/<review_id>/review.json`. The reviews dir is `PLANNOTATOR_REVIEWS_DIR`, else `reviews` in Plannotator's data dir (`~/.plannotator/reviews`, moved by `PLANNOTATOR_DATA_DIR`). The service loads every folder when it starts, so ids and links survive restarts.
- A Review's Remarks live next to it, in `<reviews dir>/<review_id>/remarks.json`: `{ "remarks": [ … ] }`, each a `Remark` with `at` (when it was stored), `status` (`open`, or `answered` once a Reply answers it) and `delivered_to` (the listener sessions it reached, in order).
- A Review's Replies live next to it, in `<reviews dir>/<review_id>/replies.json`: `{ "replies": [ … ] }`, each a `Reply`, in the order they were sent. A Reply naming Remarks marks them `answered` in `remarks.json`.
- A file Review's id is the first 16 hex characters of the SHA-256 of its path (symlinks resolved). A PR Review's id is 16 random hex characters, kept in its `review.json`, because its link must not follow from the public PR URL.
- The page at `/plannotator/session/<review_id>/` uses upstream's plan server for documents or upstream's PR code review server for PRs. The service starts it on first request, on a free loopback port, and forwards `/plannotator/session/<review_id>/<rest>` to `/<rest>` there (ADRs 0005 and 0009). Each Round starts a fresh page; PR startup checks provider authentication and fetches the current head without a local checkout.
- Send feedback (`POST /plannotator/session/<review_id>/api/feedback`, upstream's body) is the service's own: each entry of `annotations` becomes one Remark of the current Round (anchor `selector` from `blockId`, `tag` from `type`, `text` from `originalText`, `feedback` from the body's `feedback` text), stored before the answer `{ "ok": true }` and sent to the Review's listeners. A send with `feedback` text but no annotations (only question answers or code annotations, or the page's empty Done) is one `global_comment` Remark whose `text` and `feedback` are that text; a send with neither stores nothing. The page's sent draft is cleared first; when that fails the answer is HTTP 502 and nothing is stored. The page server never sees it, so the reviewer can send feedback again.
- A Review's notices live next to it, in `<reviews dir>/<review_id>/notices.json`: `{ "notices": [ … ] }`, each a Finish or Cancel `Notice` with `status` (`pending`, or `acknowledged` with `acknowledged_at` once a listener acks it). A pending notice is replayed to every subscription that adds its Review until it is acknowledged.
- The page's Round-checked commands are answered by the service, not the upstream page server (ADR 0006): Send feedback (`api/feedback`) stores Remarks; Approve (`api/approve`) finishes the Round with a Finish notice whose `notes` are the page's `feedback` text (`""` without notes; its annotations are not Remarks); Close (`api/exit`) finishes it with empty notes and `dismissed: true`. Each takes an optional `round` (body field; `?round=` for Close): not a positive integer answers 400 `round must be a positive integer`, an ended Round answers 409 `ended`, another Round answers 409 `stale-round`, and nothing is written. The page's own Round stream (`<link>api/review-round`, an event stream of `Round`) sends the Round on connect and whenever it ends or the next opens; the page's HTML pins the Round it was loaded in (`<meta name="plannotator-review-round">`), and the page sends that Round with each command and closes itself when the Round is over for it.
- Every route above is built.

## `plannotator annotate` through the service

`plannotator annotate <file> [--gate] [--json]` on a local file is a client of the running service (`apps/hook/server/annotate-service.ts`), so any number of calls on different files run at once:

1. It checks `GET /api/review/version` on `127.0.0.1:<port>`, the port in `PLANNOTATOR_SERVICE_PORT`, else 4397 (the same setting as `plannotator serve`).
2. It opens the file's Review with `{ "file": <absolute path>, "reopen": true }`, so a call on an ended Review starts its next Round on the same link, prints the link to stderr and opens it in the browser (upstream's `PLANNOTATOR_BROWSER`, `PLANNOTATOR_SKIP_BROWSER_OPEN` and Glimpse settings apply).
3. It listens on the listen socket with its own session id (`plannotator-annotate-<pid>-<hex>`), subscribed to that Review only, and takes only the opened Round's records; it acknowledges the Finish or Cancel notice it ends on. When the socket drops it reconnects under a new session id (`<session>-r<n>`), so a Remark sent to the lost socket replays to it; the 30 attempts, 1 s apart, start over at each confirmed subscription.
4. It prints the outcome in upstream's shapes (`--json`: `{"decision":"approved"}`, `{"decision":"approved","feedback":<notes>}`, `{"decision":"dismissed"}`, `{"decision":"annotated","feedback":<markdown>}`; `--gate` and the strict exit codes as upstream):
   - Approve finishes the call as approved, with the Approve's notes as feedback when there are any.
   - Close (`dismissed: true`) finishes it as dismissed.
   - Send feedback: the call cancels the Round itself, so one call is one Round, and prints the page's feedback text (each send's `feedback` once; Remarks without it are formatted as upstream's "File Feedback" markdown). Before it leaves the Review's line it answers the Remarks it took with one Reply, `Received by plannotator annotate.`, which the page shows beside each of them; so they leave `open_item_count` and the Review's next listener, such as a session on `all`, is not handed them. A Reply that fails is logged and the feedback is still printed; its Remarks stay open, so the next listener is handed them. As on upstream's page the first decision wins: an Approve or Close that ends the Round before the call's Cancel lands still gives `annotated`. The next call opens the next Round.
   - Another agent's Cancel of the Round, with no Remarks taken, fails the call: `Round <n> of <link> was cancelled by another agent.`

When nothing answers, the call fails with exit code 1 (2 under a strict flag) and tells how to start the service; it does not fall back to upstream's one-shot server, so a stopped service is never hidden. URLs, folders, `--markdown`, live apps and `--tailscale` keep upstream's one-shot server, since the service has no page for them.

## `plannotator review <PR_URL>` through the service

A call with only a supported PR/MR URL and optional `--json` opens or reopens its Review, prints its local link, opens the browser unless `PLANNOTATOR_SKIP_BROWSER_OPEN=1`, and waits with its own listen session. It reuses the annotate Round transport and prints upstream review output (`decision` and `message` in JSON): Approve includes notes, Send feedback prints the page's feedback and cancels the Round, Close prints dismissed. Taken Remarks receive a Reply before the call leaves. No service answers means failure naming `plannotator serve`, with no fallback. `--local`, `--no-local`, other mode flags and other review targets keep upstream's one-shot server.
