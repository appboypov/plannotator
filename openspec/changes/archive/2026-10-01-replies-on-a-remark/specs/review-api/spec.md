## MODIFIED Requirements

### Requirement: Unversioned version discovery
The service SHALL answer `GET /api/review/version` with HTTP 200 and JSON `{ "major": <int>, "minor": <int> }`, at a path without a version, so a client can read any major and refuse one it does not support. This build SHALL answer major 1, minor 0.

#### Scenario: A client reads the major
- **GIVEN** the review service runs on 127.0.0.1
- **WHEN** a client sends `GET /api/review/version`
- **THEN** the answer is HTTP 200 with `{ "major": 1, "minor": 0 }`

#### Scenario: A Lavish plugin client accepts the service
- **GIVEN** the service runs and the `omp-lavish-review` `ReviewApi` client points at it
- **WHEN** the client runs its major check
- **THEN** the check passes, because the major is 1 and the extra `minor` field is ignored

### Requirement: Only this Mac reaches the review API
The local service SHALL answer only requests whose Host is `127.0.0.1` or `localhost` on its port, and SHALL refuse a `POST` or listen handshake carrying a foreign `Origin` or `Referer`, with HTTP 403 `{ "error": "forbidden" }`. A header-less local client SHALL pass.

#### Scenario: A foreign Origin cannot open a Review
- **GIVEN** the review service runs on 127.0.0.1
- **WHEN** a browser page on another origin posts an open request
- **THEN** the answer is HTTP 403 `{ "error": "forbidden" }` and no Review is created

## REMOVED Requirements

### Requirement: A stub answers the contract
**Reason**: The service answers every route of the contract, so the placeholder stub is deleted.
**Migration**: Run `plannotator serve` (or `bun apps/hook/server/index.ts serve --port <n>`) and build clients against it.
