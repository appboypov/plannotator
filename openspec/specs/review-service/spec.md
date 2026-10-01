# review-service Specification

## Purpose
The fork's always-on review service, `plannotator serve`: one server for many documents, a lasting id and state folder per Review, upstream's plan page per Review under its own path, health and version. Code: `packages/server/review-service/`; decision: `adr/0005-one-upstream-annotate-server-per-review.md`.

## Requirements

### Requirement: One service serves many documents
`plannotator serve` SHALL run one long-lived server on 127.0.0.1 that serves every Review at once. It SHALL listen on port 4397 unless `--port <n>` or, without the flag, `PLANNOTATOR_SERVICE_PORT` names another port; port 0 SHALL pick a free port. A port that is not a whole number from 0 to 65535, or an unknown argument, SHALL stop the command with exit code 2 before anything listens.

#### Scenario: Two documents open at once
- **GIVEN** `plannotator serve` runs on a dev port
- **WHEN** a client opens `plan.md` and then `brief.md` through `POST /api/review/v1/reviews`
- **THEN** both answers are HTTP 200 with `status` `opened` and two different 16-hex `review_id`s
- **AND** each `link` is the service's origin followed by `/plannotator/session/<review_id>/`

#### Scenario: A port setting overrides 4397
- **GIVEN** `PLANNOTATOR_SERVICE_PORT` is 5100
- **WHEN** `plannotator serve --port 5200` starts
- **THEN** the service listens on 127.0.0.1:5200

#### Scenario: A bad port stops the command
- **GIVEN** no service runs
- **WHEN** `plannotator serve --port 70000` starts
- **THEN** it prints the error and the usage and exits with code 2

### Requirement: A Review's id stays the same for its file
A Review's id SHALL be the first 16 lowercase hex characters of the SHA-256 of the file's canonical absolute path (symlinks resolved). Opening a file whose Review exists SHALL return that Review's id, link and Round, and SHALL write only a Visibility it names.

#### Scenario: Opening the first file again
- **GIVEN** the service has opened `plan.md` as Review `a`
- **WHEN** a client opens `plan.md` again
- **THEN** the answer carries `review_id` `a`, the same `link` and the same `round`

#### Scenario: The same file through a symlink
- **GIVEN** `links/plan.md` is a symlink to the opened `plan.md`
- **WHEN** a client opens `links/plan.md`
- **THEN** the answer carries the id of `plan.md`'s Review

### Requirement: Each Review keeps its state in its own folder
The service SHALL write each Review's state to `<reviews dir>/<review_id>/review.json`, replacing the file atomically, and SHALL load every Review folder when it starts. The reviews dir SHALL be `PLANNOTATOR_REVIEWS_DIR` when set, else `reviews` inside Plannotator's data dir (`~/.plannotator/reviews` by default). A folder whose state is unreadable SHALL be skipped with a log line and left on disk.

#### Scenario: Reviews survive a restart
- **GIVEN** the service opened `plan.md` (local) and `brief.md` (public) and then stopped
- **WHEN** the service starts again on the same reviews dir
- **THEN** the list returns both Reviews with their files, Visibilities, states and Rounds
- **AND** opening `plan.md` again returns its earlier id

#### Scenario: A Visibility change is kept
- **GIVEN** an open local Review
- **WHEN** a client posts `{ "visibility": "public" }` to its visibility route
- **THEN** the answer's `link` is on `https://ctas.de-appspecialist.nl` and the Review's `review.json` holds `public`

### Requirement: The Review page is upstream's plan page under its own path
The service SHALL serve each Review's page at `/plannotator/session/<review_id>/` by forwarding `/plannotator/session/<review_id>/<rest>` to `/<rest>` on an upstream annotate server started for that Review's document with the plan page, started once on the first request for the page and kept while the service runs. `GET /plannotator/session/<review_id>/api/plan` SHALL answer upstream's plan payload whose `plan` is the file's content. A page path without its trailing slash SHALL redirect (308) to the path with it. An unknown id SHALL answer HTTP 404 `{ "error": "review not found" }`. A page whose server cannot start SHALL answer HTTP 502 `{ "error": "page failed to start: <reason>" }` and SHALL be tried again on the next request.

#### Scenario: Each page returns its own document
- **GIVEN** the service opened `plan.md` as Review `a` and `brief.md` as Review `b`
- **WHEN** a client sends `GET /plannotator/session/a/api/plan` and `GET /plannotator/session/b/api/plan`
- **THEN** both answer HTTP 200, the first with `plan.md`'s content as `plan` and the second with `brief.md`'s

#### Scenario: Loading the page is listed
- **GIVEN** an open Review whose page was never loaded
- **WHEN** a browser loads `/plannotator/session/<review_id>/`
- **THEN** the answer is the plan page's HTML and the list shows the Review's `last_page_open` as that time

### Requirement: The service answers health and version
`GET /plannotator/health` SHALL answer HTTP 200 `{ "ok": true, "app": "plannotator", "version": <build version>, "api": { "major": 1, "minor": 0 } }` while the service runs, and `GET /api/review/version` SHALL answer `{ "major": 1, "minor": 0 }`. Every route SHALL apply the contract's Host and Origin rule (HTTP 403 `forbidden`).

#### Scenario: Health answers while the service runs
- **GIVEN** `plannotator serve` runs on a dev port
- **WHEN** a client sends `GET /plannotator/health`
- **THEN** the answer is HTTP 200 with `ok` true and API major 1

#### Scenario: A foreign page cannot open a Review
- **GIVEN** the service runs
- **WHEN** a request with `Origin: https://evil.example` posts an open request
- **THEN** the answer is HTTP 403 and no Review is created

### Requirement: A Review page works under its own link
A plan page served under a session path (`.../plannotator/session/<review_id>/`) SHALL send every call its client makes to a root API path (`/api/...` on the page's own host) through `fetch`, `EventSource`, `WebSocket` or an image source to the same path under its base, `<base>api/...`. The base SHALL be read from the page's location, so the page works on any origin that serves it. A page outside a session path SHALL keep upstream's root calls.

#### Scenario: The document renders and takes an annotation
- **GIVEN** the service runs and a Review is open for `plan.md`
- **WHEN** a browser loads the Review's link, selects text and saves a comment
- **THEN** the page shows `plan.md`'s content and the comment
- **AND** the network log holds `<base>api/plan` and `<base>api/draft` and no request to a root `/api/` path

#### Scenario: Absolute same-host and socket URLs are rebased
- **GIVEN** a page at `/plannotator/session/0123456789abcdef/`
- **WHEN** its client calls `http://<page host>/api/feedback` with a `Request` and opens `ws://<page host>/api/terminal`
- **THEN** the calls go to `http://<page host>/plannotator/session/0123456789abcdef/api/feedback` and `ws://<page host>/plannotator/session/0123456789abcdef/api/terminal`

#### Scenario: A plain annotate page is unchanged
- **GIVEN** a page at `/`
- **WHEN** its client fetches `/api/plan`
- **THEN** the request goes to `/api/plan`

### Requirement: Remarks wait for a listener
The service SHALL answer a Review page's Send feedback (`POST <link>api/feedback` with upstream's body) itself: each entry of `annotations` SHALL become one Remark of the Review's current Round with an id of `fi_` plus 24 lowercase hex characters, stored in the Review's folder before the answer `{ "ok": true }`. The listen socket SHALL deliver each open Remark to every listener session whose subscription includes its Review, live when the session listens and on its next subscription otherwise, and SHALL deliver it to a session once, across reconnects and restarts. The list SHALL count a Review's open Remarks and name its listener sessions.

#### Scenario: Remarks sent with no listener arrive once
- **GIVEN** the service runs and a Review is open with no listener
- **WHEN** the reviewer sends feedback with two annotations and a listener then connects and subscribes to the Review
- **THEN** the listener receives two `feedback_item` frames with `fi_` ids before `subscribed`
- **AND** when the same session reconnects and subscribes again it receives only `subscribed`

#### Scenario: A Remark sent while a session listens arrives live
- **GIVEN** a listener subscribed to all Reviews
- **WHEN** the reviewer sends feedback with one comment
- **THEN** the listener receives its `feedback_item` at once
- **AND** after a service restart the same session does not receive it again while the list still counts it open

#### Scenario: The reviewer sends feedback again
- **GIVEN** a Review whose reviewer already sent feedback
- **WHEN** the reviewer sends feedback with another annotation
- **THEN** the service stores it as a further Remark and the page's sent draft is cleared

#### Scenario: The list shows open Remarks and listeners
- **GIVEN** a Review with two open Remarks and two listener sessions subscribed to it
- **WHEN** a client lists the Review's file
- **THEN** the Review reports `open_item_count` 2, both sessions under `listeners`, and both Remarks under `open_items`

#### Scenario: The socket refuses what the contract refuses
- **GIVEN** the service runs
- **WHEN** a client connects without a session, from a foreign origin, or sends a frame that is not JSON or is over 64 KiB
- **THEN** the handshake answers 400 `session required` or 403, a bad frame gets an `error` frame, and an oversized frame closes the socket with 1009
