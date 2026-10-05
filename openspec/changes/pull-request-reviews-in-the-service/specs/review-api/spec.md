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
