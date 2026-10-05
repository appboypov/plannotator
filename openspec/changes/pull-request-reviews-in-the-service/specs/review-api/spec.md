## ADDED Requirements

### Requirement: PR subjects share the Review API
The service SHALL accept a PR/MR URL supported by upstream parsePRUrl in the file field, canonicalize it without network I/O on open and list, and derive the Review id from that canonical subject. The list SHALL keep the canonical URL in file. Unsupported HTTP(S) URLs SHALL answer 400 naming the URL. Rounds, reopen, Replies, Cancel and Visibility SHALL keep the file Review contract. The API SHALL report major 1 and minor 2.

#### Scenario: URL variants identify one Review
- **GIVEN** a Review opened for https://github.com/owner/repo/pull/22/files
- **WHEN** a client opens or lists with https://github.com/owner/repo/pull/22/
- **THEN** it receives the same Review id and canonical file https://github.com/owner/repo/pull/22

#### Scenario: Invalid URL writes nothing
- **WHEN** a client opens https://example.com/not-a-pr
- **THEN** the service answers 400 naming that URL and creates no Review

## MODIFIED Requirements

### Requirement: Unversioned version discovery
The service SHALL answer `GET /api/review/version` with HTTP 200 and JSON `{ "major": <int>, "minor": <int> }`, at a path without a version, so a client can read any major and refuse one it does not support. This build SHALL answer major 1, minor 2.

#### Scenario: A client reads the major
- **GIVEN** the review service runs on 127.0.0.1
- **WHEN** a client sends `GET /api/review/version`
- **THEN** the answer is HTTP 200 with `{ "major": 1, "minor": 2 }`

#### Scenario: A Lavish plugin client accepts the service
- **GIVEN** the service runs and the `omp-lavish-review` ReviewApi client points at it
- **WHEN** the client runs its major check
- **THEN** the check passes, because the major is 1 and the extra `minor` field is ignored
