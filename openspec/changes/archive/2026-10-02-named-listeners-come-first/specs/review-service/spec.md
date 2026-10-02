## ADDED Requirements

### Requirement: One listener holds each Review
The service SHALL keep, for each Review, a line of the listeners whose subscription includes it: first the listeners whose subscription names the Review, in the order they started naming it, then the listeners subscribed to all Reviews, in the order they subscribed to all. A listener SHALL keep its place while its later subscriptions keep the Review in the same way, and a new socket SHALL join the back of its group, also when it replaces a socket of the same session. The first listener in the line holds the Review, and every Remark, Finish notice and Cancel notice of the Review SHALL go to its holder only.

#### Scenario: A listener that names the Review comes before one subscribed to all
- **GIVEN** a listener with session id `chat` subscribed to all Reviews, and an open Review A
- **WHEN** a listener with session id `agent` subscribes to Review A and the reviewer sends feedback on Review A's page
- **THEN** `agent` receives the `feedback_item` and `chat` receives no frame for it

#### Scenario: The first listener that names a Review holds it
- **GIVEN** a listener `s1` subscribed to Review A
- **WHEN** a listener `s2` subscribes to Review A and the reviewer sends feedback on its page
- **THEN** only `s1` receives the `feedback_item`

#### Scenario: A listener subscribed to all hears the Reviews nobody names
- **GIVEN** a listener `chat` subscribed to all Reviews and a listener `agent` subscribed to Review A
- **WHEN** a Review B is opened after both subscriptions and the reviewer sends feedback on its page
- **THEN** `chat` receives the `feedback_item` of Review B

#### Scenario: Keeping a Review in a new subscription keeps the place
- **GIVEN** a listener `s1` subscribed to Review A and a listener `s2` subscribed to Review A after it
- **WHEN** `s1` replaces its subscription with Reviews A and B and the reviewer sends feedback on Review A's page
- **THEN** only `s1` receives the `feedback_item`

#### Scenario: A replacing socket joins the back of its group
- **GIVEN** a listener `s1` subscribed to Review A and a listener `s2` subscribed to Review A after it
- **WHEN** a new socket of session `s1` replaces the first and subscribes to Review A, and the reviewer sends feedback on Review A's page
- **THEN** only `s2` receives the `feedback_item`

#### Scenario: Only the holder hears an Approve
- **GIVEN** a listener `chat` subscribed to all Reviews and a listener `agent` subscribed to an open Review A
- **WHEN** the reviewer approves Review A
- **THEN** `agent` receives the `finish` notice and `chat` receives no frame for it

### Requirement: The next listener in line takes over a Review
When a Review's holder leaves its line, because its socket closes, it is dropped after a missed ping, or its subscription no longer includes the Review, or when a listener that names the Review joins ahead of a holder subscribed to all, the new holder SHALL first receive the Review's open Remarks its session has not received and its pending notices its socket has not received, in store order, and then the Review's live events.

#### Scenario: An unanswered Remark falls back to the listener subscribed to all
- **GIVEN** a listener `chat` subscribed to all Reviews, and a listener `agent` subscribed to Review A that received a Remark nobody answered
- **WHEN** `agent`'s socket closes and the reviewer sends feedback on Review A's page again
- **THEN** `chat` receives the first Remark's `feedback_item` and then the second's

#### Scenario: A pending Close falls back with the Review
- **GIVEN** a listener `chat` subscribed to all Reviews, and a listener `agent` subscribed to Review A that received the `finish` with `dismissed: true` of the reviewer's Close and did not acknowledge it
- **WHEN** `agent` replaces its subscription with an empty set
- **THEN** `chat` receives that `finish` with `dismissed: true`

#### Scenario: A Remark answered before the hand-over is not handed over
- **GIVEN** a listener `chat` subscribed to all Reviews, and a listener `agent` subscribed to Review A that received a Remark and posted a Reply answering it
- **WHEN** `agent`'s socket closes
- **THEN** `chat` receives no frame for that Remark

#### Scenario: A listener that names the Review takes it over from the listener subscribed to all
- **GIVEN** a listener `chat` subscribed to all Reviews that received a Remark of Review A nobody answered
- **WHEN** a listener `agent` subscribes to Review A
- **THEN** `agent` receives that Remark's `feedback_item` before its `subscribed`, and later Remarks of Review A reach only `agent`

#### Scenario: A dropped holder hands the Review over
- **GIVEN** a listener `chat` subscribed to all Reviews and a listener `agent` subscribed to Review A that stops answering pings
- **WHEN** the service drops `agent` and the reviewer sends feedback on Review A's page
- **THEN** `chat` receives the `feedback_item`

### Requirement: A subscription replays only the Reviews its listener holds
For every Review a listener holds after a subscription and did not hold before, the service SHALL first send the Review's open Remarks its session has not received and its pending notices its socket has not received, in store order, then confirm with `subscribed`. A Review the listener keeps holding SHALL NOT be replayed again, and a Review another listener holds SHALL NOT be replayed to it.

#### Scenario: Adding a Review on an open socket replays it
- **GIVEN** a listener subscribed to Review A and an open Remark on Review B nobody received
- **WHEN** the listener replaces its subscription with Reviews A and B
- **THEN** it receives Review B's `feedback_item` before `subscribed` and none of Review A's again

#### Scenario: Subscribing to all skips a Review another listener names
- **GIVEN** a listener `agent` subscribed to Review A, and open Remarks on Reviews A and B
- **WHEN** a listener `chat` subscribes to all Reviews
- **THEN** `chat` receives Review B's open Remark and none of Review A's

#### Scenario: A listener behind the holder gets no replay
- **GIVEN** a listener `s1` subscribed to Review A and a pending Finish notice on Review A
- **WHEN** a listener `s2` subscribes to Review A
- **THEN** `s2` receives only `subscribed`

## MODIFIED Requirements

### Requirement: Remarks wait for a listener
The service SHALL answer a Review page's Send feedback (`POST <link>api/feedback` with upstream's body) itself: each entry of `annotations` SHALL become one Remark of the Review's current Round with an id of `fi_` plus 24 lowercase hex characters, stored in the Review's folder before the answer `{ "ok": true }`. The listen socket SHALL deliver each open Remark to the listener session that holds its Review, live when a listener holds it and once a listener comes to hold it otherwise, and SHALL deliver it to a session once, across reconnects and restarts. The list SHALL count a Review's open Remarks and name the sessions in its Review's line, its holder first.

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

#### Scenario: The holder is listed first
- **GIVEN** a listener `chat` subscribed to all Reviews before a listener `agent` subscribed to Review A
- **WHEN** a client lists Reviews
- **THEN** Review A's entry carries `listeners` `["agent", "chat"]`

### Requirement: Rounds, Approve, Cancel and list

The service SHALL finish a Review's Round when the reviewer approves or closes its page, recording a Finish notice with the page's notes; SHALL cancel the Round on an agent's Cancel, recording a Cancel notice; SHALL send each notice to the Review's holder and replay a pending notice to each next holder until acknowledged; SHALL open the next Round on the same link when a cancelled Review, or a finished one with `reopen`, is opened; SHALL refuse a page command for a Round that is not open with HTTP 409; and SHALL list each Review with its state and Round.

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
- **THEN** the Review's holder receives a `cancel` notice and the page's Round stream reports `cancelled`
- **AND** a page command answers 409 `ended` with `ended_by` `agent`

#### Scenario: A stale Round is refused

- **GIVEN** a Review in round 2
- **WHEN** the page sends feedback for round 1
- **THEN** the service answers 409 `stale-round` with round 2 and stores nothing

### Requirement: The service answers health and version
`GET /plannotator/health` SHALL answer HTTP 200 `{ "ok": true, "app": "plannotator", "version": <build version>, "api": { "major": 1, "minor": 1 } }` while the service runs, adding `"service": { "label": <LaunchAgent label> }` when `PLANNOTATOR_SERVICE_LABEL` names the LaunchAgent that runs it, and `GET /api/review/version` SHALL answer `{ "major": 1, "minor": 1 }`. Every route SHALL apply the contract's Host and Origin rule (HTTP 403 `forbidden`).

#### Scenario: Health answers while the service runs
- **GIVEN** `plannotator serve` runs on a dev port
- **WHEN** a client sends `GET /plannotator/health`
- **THEN** the answer is HTTP 200 with `ok` true and API major 1 and minor 1

#### Scenario: Health names the LaunchAgent
- **GIVEN** launchd runs the service as `nl.de-appspecialist.plannotator`
- **WHEN** a client sends `GET /plannotator/health`
- **THEN** the answer carries `service.label` `nl.de-appspecialist.plannotator`

#### Scenario: A foreign page cannot open a Review
- **GIVEN** the service runs
- **WHEN** a request with `Origin: https://evil.example` posts an open request
- **THEN** the answer is HTTP 403 and no Review is created
