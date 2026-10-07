## ADDED Requirements

### Requirement: PR subjects share the Review API
The service SHALL accept a PR/MR URL supported by upstream parsePRUrl in the file field, canonicalize it without network I/O on open and list, and find its Review by that canonical subject. A new PR Review SHALL get 16 random hex characters as its id, kept across restarts, because a PR URL is public and the id is the secret part of its door link. The list SHALL keep the canonical URL in file. Unsupported HTTP(S) URLs SHALL answer 400 naming the URL. Rounds, reopen, Replies, Cancel and Visibility SHALL keep the file Review contract.

#### Scenario: URL variants identify one Review
- **GIVEN** a Review opened for https://github.com/owner/repo/pull/22/files
- **WHEN** a client opens or lists with https://github.com/owner/repo/pull/22/
- **THEN** it receives the same Review id and canonical file https://github.com/owner/repo/pull/22
- **AND** after a service restart, opening https://github.com/owner/repo/pull/22 returns that same Review id

#### Scenario: An id worked out from the URL opens nothing through a door
- **GIVEN** a public Review for https://github.com/owner/repo/pull/22
- **WHEN** its public door receives the page, GET api/diff, and POST api/feedback with approved true, api/approve and api/exit under the id made from the first 16 hex characters of the URL's SHA-256
- **THEN** each answers 404, and the Review stays open without a Remark

#### Scenario: Invalid URL writes nothing
- **WHEN** a client opens https://example.com/not-a-pr
- **THEN** the service answers 400 naming that URL and creates no Review
