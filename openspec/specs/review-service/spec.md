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
`GET /plannotator/health` SHALL answer HTTP 200 `{ "ok": true, "app": "plannotator", "version": <build version>, "api": { "major": 1, "minor": 0 } }` while the service runs, adding `"service": { "label": <LaunchAgent label> }` when `PLANNOTATOR_SERVICE_LABEL` names the LaunchAgent that runs it, and `GET /api/review/version` SHALL answer `{ "major": 1, "minor": 0 }`. Every route SHALL apply the contract's Host and Origin rule (HTTP 403 `forbidden`).

#### Scenario: Health answers while the service runs
- **GIVEN** `plannotator serve` runs on a dev port
- **WHEN** a client sends `GET /plannotator/health`
- **THEN** the answer is HTTP 200 with `ok` true and API major 1

#### Scenario: Health names the LaunchAgent
- **GIVEN** launchd runs the service as `nl.de-appspecialist.plannotator`
- **WHEN** a client sends `GET /plannotator/health`
- **THEN** the answer carries `service.label` `nl.de-appspecialist.plannotator`

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

### Requirement: Rounds, Approve, Cancel and list

The service SHALL finish a Review's Round when the reviewer approves or closes its page, recording a Finish notice with the page's notes; SHALL cancel the Round on an agent's Cancel, recording a Cancel notice; SHALL replay pending notices to listeners until acknowledged; SHALL open the next Round on the same link when a cancelled Review, or a finished one with `reopen`, is opened; SHALL refuse a page command for a Round that is not open with HTTP 409; and SHALL list each Review with its state and Round.

#### Scenario: Approve with a note reaches the listener

- **GIVEN** an open Review with a listener
- **WHEN** the reviewer approves with the note "Ship it"
- **THEN** the listener receives a `finish` notice with notes "Ship it"
- **AND** the list shows the Review `finished` in round 1

#### Scenario: Reopen gives the next Round on the same link

- **GIVEN** a finished Review
- **WHEN** the agent opens its file without `reopen`
- **THEN** the answer is `user-ended` in round 1
- **AND WHEN** the agent opens it with `reopen`
- **THEN** the answer has the same id and link, status `opened` and round 2

#### Scenario: Cancel closes the page

- **GIVEN** an open Review whose page is open
- **WHEN** the agent cancels it
- **THEN** listeners receive a `cancel` notice and the page's Round stream reports `cancelled`
- **AND** a page command answers 409 `ended` with `ended_by` `agent`

#### Scenario: A stale Round is refused

- **GIVEN** a Review in round 2
- **WHEN** the page sends feedback for round 1
- **THEN** the service answers 409 `stale-round` with round 2 and stores nothing

### Requirement: Metadata saves keep the latest Round

The service SHALL save a Visibility change or a page load's `last_page_open` onto the Review as it is when the save happens, so a Cancel, Approve or reopen that landed while the request was in flight SHALL stand.

#### Scenario: A slow Visibility body after a Cancel

- **GIVEN** an open Review
- **WHEN** a Visibility request's body arrives after the agent cancelled the Review
- **THEN** the Review is `cancelled` with the new visibility

#### Scenario: A slow page load after a Cancel

- **GIVEN** an open Review whose page is loading
- **WHEN** the agent cancels before the page's HTML arrives
- **THEN** the Review stays `cancelled` and records `last_page_open`

### Requirement: A refused page command keeps the open Round's draft

The service SHALL check a page command's Round against the Review as it is once the command's body has arrived, before clearing any draft, so a command refused with HTTP 409 SHALL leave the page's draft untouched.

#### Scenario: A slow round 1 command after the next Round opened

- **GIVEN** an open Review in round 1 and a Send feedback for round 1 whose body is slow
- **WHEN** the agent cancels and reopens the Review into round 2 and the reviewer saves a round 2 draft before the body arrives
- **THEN** the command answers 409 `stale-round`
- **AND** the round 2 draft is still there and no Remark is stored

### Requirement: Replies on a Remark

The service SHALL store an agent's Reply in the Review's folder, SHALL mark each Remark it names `answered` so no later subscription replays it, SHALL refuse a Reply naming a Remark the Review does not have with HTTP 400 and write nothing, and SHALL answer the Review page's `api/review-replies` with every Remark and the Replies that name it, also after a restart and on an ended Round.

#### Scenario: A Reply shows under its Remark after a restart

- **GIVEN** a Review with a Remark sent from its page
- **WHEN** an agent posts a Reply answering that Remark
- **AND** the service restarts
- **THEN** `GET <link>api/review-replies` returns the Remark with status `answered` and that Reply under it

#### Scenario: An answered Remark is not replayed

- **GIVEN** a Review with two Remarks and a Reply answering the first
- **WHEN** a new listener subscribes to the Review
- **THEN** it receives only the second Remark

#### Scenario: A Reply naming an unknown Remark writes nothing

- **GIVEN** a Review with one Remark
- **WHEN** an agent posts a Reply naming that Remark and an id the Review does not have
- **THEN** the answer is HTTP 400 `unknown feedback items` naming the unknown id
- **AND** the page route shows the Remark open without Replies

#### Scenario: An ended Review takes a Reply naming no Remark

- **GIVEN** a cancelled Review
- **WHEN** an agent posts a Reply without `answers`
- **THEN** the answer is HTTP 200 with `answered` empty
- **AND** the page route lists that Reply among the Replies naming no Remark

### Requirement: Replies and Round state show on the page

A Review page SHALL list, in its annotation panel, the Remarks the reviewer sent in every Round, read-only and apart from the draft, each with the agents' Replies under it; SHALL never send a listed Remark again; and SHALL show the Round number when its Round is finished, cancelled, or replaced by a later Round, and a page from an earlier Round SHALL NOT act on the current one.

#### Scenario: A Reply shows under the Remark it answers

- **GIVEN** a Review page where the reviewer sent the Remark "Please tighten the heading."
- **WHEN** an agent replies "Tightened it." to that Remark and the reviewer reloads the page
- **THEN** the annotation panel lists the Remark under "Sent", stamped "Round 1"
- **AND** the Reply "Tightened it." shows under it, labelled "Reply"
- **AND** the Remark has no edit or delete control

#### Scenario: Sent Remarks are not sent again

- **GIVEN** a Review page listing a sent Remark
- **WHEN** the reviewer adds a comment and sends feedback
- **THEN** the service stores one new Remark, the new comment

#### Scenario: A finished Round shows as finished

- **GIVEN** a Review whose reviewer approved round 1
- **WHEN** the page is loaded
- **THEN** the page is covered with "Round 1 is finished"

#### Scenario: A stale tab cannot send to the next Round

- **GIVEN** a tab loaded in round 1 whose Round stream delivers nothing
- **WHEN** the agent reopens the Review into round 2 and the tab sends feedback
- **THEN** the service answers 409 `stale-round` and stores nothing
- **AND** the tab is covered with "Round 2 is open" and offers a reload

### Requirement: The service runs under launchd

`plannotator service install` SHALL install the running compiled binary at `~/.local/bin/plannotator` and load the LaunchAgent `nl.de-appspecialist.plannotator`, which runs `plannotator serve` at login, keeps it alive and restarts it when it exits, with logs under `~/Library/Logs/plannotator/`. Install SHALL replace a loaded service and succeed only when health answers with the binary's version and the LaunchAgent's label. `service uninstall` SHALL unload it and remove its plist; `service status` SHALL show launchd's state and the service's health.

#### Scenario: Install starts the service

- **GIVEN** a binary built with `bun fork/build-binary.ts`
- **WHEN** Brian runs `fork/dist/plannotator service install`
- **THEN** `launchctl print gui/$UID/nl.de-appspecialist.plannotator` shows it running
- **AND** `curl 127.0.0.1:4397/plannotator/health` answers 200 with the version `plannotator --version` prints and `service.label` `nl.de-appspecialist.plannotator`

#### Scenario: A killed service comes back

- **GIVEN** the service runs under launchd
- **WHEN** its process is killed
- **THEN** launchd starts a new process and health answers 200 again

#### Scenario: Install from source changes nothing

- **GIVEN** `plannotator` run from source with Bun
- **WHEN** `service install` runs
- **THEN** it exits 1 naming the build command, and no binary or plist is written

#### Scenario: Another server on the port fails the install

- **GIVEN** a server launchd does not run answers on 4397
- **WHEN** `service install` runs
- **THEN** it exits 1 naming what answers and the log file

### Requirement: Close is told apart from Approve

The Finish notice of a Close (`api/exit`) SHALL carry `dismissed: true`; an Approve's Finish SHALL NOT carry it. The field SHALL be stored with the notice and kept on replay.

#### Scenario: Close finishes dismissed

- **GIVEN** an open Review with a listener
- **WHEN** the reviewer closes the page
- **THEN** the listener receives a `finish` with `notes: ""` and `dismissed: true`

#### Scenario: Approve without notes is not dismissed

- **GIVEN** an open Review with a listener
- **WHEN** the reviewer approves without notes
- **THEN** the listener receives a `finish` with `notes: ""` and no `dismissed`

### Requirement: Remarks carry the page's feedback text

Each Remark of a Send feedback SHALL carry the page's `feedback` text as `feedback` when the page sent one. A Send feedback with that text and no annotations SHALL store one `global_comment` Remark whose `text` and `feedback` are the text; a send with neither SHALL store nothing.

#### Scenario: Annotations with the page's text

- **GIVEN** an open Review
- **WHEN** the reviewer sends two annotations and the page's text
- **THEN** two Remarks are stored and each carries the page's text as `feedback`

#### Scenario: Only question answers

- **GIVEN** an open Review
- **WHEN** the page sends feedback text and no annotations
- **THEN** one `global_comment` Remark is stored with that text

#### Scenario: Nothing sent

- **GIVEN** an open Review
- **WHEN** the page sends no annotations and empty text
- **THEN** no Remark is stored
