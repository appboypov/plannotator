## ADDED Requirements

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
