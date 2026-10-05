# review-api Specification

## Purpose
The fork's review API v1: version discovery, the Review routes, the listen socket's messages, Visibility and links, shaped like Lavish's review API so a Lavish plugin client reads it unchanged. Prose contract: `docs/review-api.md`; types: `packages/shared/review-api/`.

## Requirements

### Requirement: Unversioned version discovery
The service SHALL answer `GET /api/review/version` with HTTP 200 and JSON `{ "major": <int>, "minor": <int> }`, at a path without a version, so a client can read any major and refuse one it does not support. This build SHALL answer major 1, minor 3, the minor raised since a Review can link a Multica issue.

#### Scenario: A client reads the major
- **GIVEN** the review service runs on 127.0.0.1
- **WHEN** a client sends `GET /api/review/version`
- **THEN** the answer is HTTP 200 with `{ "major": 1, "minor": 3 }`

#### Scenario: A Lavish plugin client accepts the service
- **GIVEN** the service runs and the `omp-lavish-review` `ReviewApi` client points at it
- **WHEN** the client runs its major check
- **THEN** the check passes, because the major is 1 and the extra `minor` field is ignored

### Requirement: Review routes shaped like Lavish's review API v1
The service SHALL serve open (`POST /api/review/v1/reviews`), list (`GET /api/review/v1/reviews`), reply (`POST .../:review_id/replies`), cancel (`POST .../:review_id/cancel`) and visibility (`POST .../:review_id/visibility`) with the JSON field names of Lavish's review API v1. Additions (a `reply` object in the Reply answer, `notes` on a Finish notice) SHALL be additive only.

#### Scenario: Opening a file returns a Review on its own link
- **GIVEN** an existing Markdown file at an absolute path
- **WHEN** a client posts `{ "file": "<path>" }` to `/api/review/v1/reviews`
- **THEN** the answer is HTTP 200 with a 16-hex `review_id`, `status` `opened`, `round` 1, `visibility` `local` and a `link` ending in `/plannotator/session/<review_id>/`

#### Scenario: Opening the same file again keeps the id
- **GIVEN** a file whose Review is open
- **WHEN** a client opens the same file again
- **THEN** the answer carries the same `review_id` and `link` and the same Round

#### Scenario: A Reply naming an unknown Remark writes nothing
- **GIVEN** an open Review
- **WHEN** a client posts a Reply whose `answers` names an id that is not a Remark of the Review
- **THEN** the answer is HTTP 400 `{ "error": "unknown feedback items", "unknown": [<that id>] }`

#### Scenario: An unknown Review is not found
- **GIVEN** no Review with id `ffffffffffffffff`
- **WHEN** a client cancels it
- **THEN** the answer is HTTP 404 `{ "error": "review not found" }`

### Requirement: Three Visibilities with one page path
A Review's Visibility SHALL be `local`, `public` or `temporary`. Its link SHALL keep the path `/plannotator/session/<review_id>/` and take the origin of its Visibility: the service's own address, `https://ctas.de-appspecialist.nl`, or the ngrok host. Any other Visibility SHALL be refused with HTTP 400 `visibility must be local, public or temporary`.

#### Scenario: A temporary Review links through ngrok
- **GIVEN** an open Review
- **WHEN** a client sets its Visibility to `temporary`
- **THEN** the answer's `link` is the ngrok origin followed by `/plannotator/session/<review_id>/`

#### Scenario: An unknown Visibility is refused
- **GIVEN** an existing file
- **WHEN** a client opens it with `visibility` `private`
- **THEN** the answer is HTTP 400 and no Review is created

### Requirement: Listen socket messages
The listen socket at `/api/review/v1/listen?session=<id>` SHALL take `subscribe` and `ack` messages and send `feedback_item`, `finish`, `cancel`, `subscribed` and `error` messages with Lavish's shapes. It SHALL send no `listener` message about other sessions and no `page_open` message when a Review page is loaded. A handshake without a session SHALL be refused with HTTP 400.

#### Scenario: Subscribing is confirmed with the normalized subscription
- **GIVEN** a listener connected with a session id
- **WHEN** it sends `{ "type": "subscribe", "reviews": ["<id>", "<id>"] }`
- **THEN** it receives `{ "type": "subscribed", "reviews": ["<id>"] }`

#### Scenario: A bad frame is refused and the socket stays open
- **GIVEN** a connected listener
- **WHEN** it sends a frame that is not a JSON subscribe or ack message
- **THEN** it receives a `{ "type": "error" }` message and can still subscribe

#### Scenario: A second socket for the same session replaces the first
- **GIVEN** a listener connected as session `s1`
- **WHEN** another socket connects as session `s1`
- **THEN** the first socket closes with code 1000

#### Scenario: Another listener on the same Review is not announced
- **GIVEN** a listener `s1` subscribed to all Reviews
- **WHEN** a listener `s2` subscribes to Review A
- **THEN** `s2` receives only `subscribed` and `s1` receives no frame

#### Scenario: A page load sends no frame
- **GIVEN** a listener subscribed to Review A
- **WHEN** Review A's page is loaded
- **THEN** the listener receives no frame and the list shows the time of the load as Review A's `last_page_open`

### Requirement: Only this Mac reaches the review API
The local service SHALL answer only requests whose Host is `127.0.0.1` or `localhost` on its port, and SHALL refuse a `POST` or listen handshake carrying a foreign `Origin` or `Referer`, with HTTP 403 `{ "error": "forbidden" }`. A header-less local client SHALL pass.

#### Scenario: A foreign Origin cannot open a Review
- **GIVEN** the review service runs on 127.0.0.1
- **WHEN** a browser page on another origin posts an open request
- **THEN** the answer is HTTP 403 `{ "error": "forbidden" }` and no Review is created

### Requirement: A Review opens linked to a Multica issue
The open call SHALL take an optional `issue` object with `id` (a Multica issue key such as `WORK-167`, or its id) and `workspace_id` (the Multica workspace id), both stored trimmed. The Review SHALL store it and return it in the open answer. Opening again without `issue` SHALL keep the stored issue; opening with `issue` SHALL replace it. An `issue` that is not an object with nonblank string `id` and `workspace_id` SHALL be refused with 400 `issue requires nonempty id and workspace_id strings`, and an `issue` while `PLANNOTATOR_MULTICA_PROFILE` is unset or blank SHALL be refused with 400 `PLANNOTATOR_MULTICA_PROFILE is required to link an issue`; neither refusal opens or changes a Review. The Review list SHALL carry each Review's `issue`, or null.

#### Scenario: Opening with an issue links the Review
- **GIVEN** a service with `PLANNOTATOR_MULTICA_PROFILE` set
- **WHEN** a client opens a file with `issue` `{ "id": "WORK-1", "workspace_id": "W" }`
- **THEN** the answer and the Review list carry that `issue`

#### Scenario: Opening again keeps the issue
- **GIVEN** a Review linked to `WORK-1`
- **WHEN** a client opens its file without `issue`
- **THEN** the answer and the Review list still carry `WORK-1`

#### Scenario: Opening with another issue replaces it
- **GIVEN** a Review linked to `WORK-1`
- **WHEN** a client opens its file with `issue` `{ "id": "WORK-2", "workspace_id": "W" }`
- **THEN** the answer and the Review list carry `WORK-2`

#### Scenario: An unlinked Review lists null
- **GIVEN** a Review opened without `issue`
- **WHEN** a client lists the Reviews
- **THEN** its row carries `"issue": null`

#### Scenario: An issue without the setting is refused
- **GIVEN** a service without `PLANNOTATOR_MULTICA_PROFILE`
- **WHEN** a client opens a file with `issue`
- **THEN** the response is 400 naming `PLANNOTATOR_MULTICA_PROFILE`, and no Review is opened or changed

#### Scenario: An incomplete issue is refused
- **GIVEN** a running service
- **WHEN** a client opens a file with `issue` `{ "id": "WORK-1" }` or with a blank `workspace_id`
- **THEN** the response is 400, and no Review is opened or changed
