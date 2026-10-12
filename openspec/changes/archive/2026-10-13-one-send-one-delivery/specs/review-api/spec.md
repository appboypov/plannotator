## MODIFIED Requirements

### Requirement: Unversioned version discovery
The service SHALL answer `GET /api/review/version` with HTTP 200 and JSON `{ "major": <int>, "minor": <int> }`, at a path without a version, so a client can read any major and refuse one it does not support. This build SHALL answer major 1, minor 4, adding optional send batch identity without breaking legacy clients.

#### Scenario: A client reads the major
- **GIVEN** the review service runs on 127.0.0.1
- **WHEN** a client sends `GET /api/review/version`
- **THEN** the answer is HTTP 200 with `{ "major": 1, "minor": 4 }`

#### Scenario: A Lavish plugin client accepts the service
- **GIVEN** the service runs and the `omp-lavish-review` `ReviewApi` client points at it
- **WHEN** the client runs its major check
- **THEN** the check passes, because the major is 1 and the extra `minor` field is ignored

## ADDED Requirements

### Requirement: One Send feedback has one batch identity
Every Remark stored from one Send feedback SHALL carry the same newly generated `batch_id`, `bt_` plus 24 lowercase hex characters. Stored Remarks predating this field SHALL remain without it and SHALL parse without backfill. Live and replayed `feedback_item` frames and listed `open_items` SHALL include `batch_id` only when the record has it. A send's frames SHALL remain consecutive and in store order.

#### Scenario: A send with multiple annotations
- **GIVEN** an open Review
- **WHEN** the reviewer sends N annotations
- **THEN** N stored Remarks, N consecutive listen frames and N listed open items share one batch identity

#### Scenario: Legacy replay
- **GIVEN** a stored Remark without batch identity
- **WHEN** the service restarts and replays or lists it
- **THEN** the Remark remains available without a `batch_id` field
