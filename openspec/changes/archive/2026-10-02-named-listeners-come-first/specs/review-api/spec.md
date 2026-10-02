## MODIFIED Requirements

### Requirement: Unversioned version discovery
The service SHALL answer `GET /api/review/version` with HTTP 200 and JSON `{ "major": <int>, "minor": <int> }`, at a path without a version, so a client can read any major and refuse one it does not support. This build SHALL answer major 1, minor 1, the minor raised since one listener holds each Review.

#### Scenario: A client reads the major
- **GIVEN** the review service runs on 127.0.0.1
- **WHEN** a client sends `GET /api/review/version`
- **THEN** the answer is HTTP 200 with `{ "major": 1, "minor": 1 }`

#### Scenario: A Lavish plugin client accepts the service
- **GIVEN** the service runs and the `omp-lavish-review` `ReviewApi` client points at it
- **WHEN** the client runs its major check
- **THEN** the check passes, because the major is 1 and the extra `minor` field is ignored

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
