## ADDED Requirements

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
