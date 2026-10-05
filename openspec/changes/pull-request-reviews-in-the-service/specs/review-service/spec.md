## ADDED Requirements

### Requirement: A PR Review serves upstream code review
The service SHALL start upstream startReviewServer in PR mode on first page request after auth and fetch, on a free loopback port without a checkout. It SHALL retain that page per Round, stop it when the next Round opens, and retry failed startup on the next request. The review app SHALL install session-path base, Round commands and closure cover before rendering.

#### Scenario: A fresh Round fetches the head
- **GIVEN** a PR Review whose Round ends
- **WHEN** it reopens and its page loads
- **THEN** the service starts a fresh PR page with the PR current head

### Requirement: Code decisions use ordinary Remarks and notices
The service SHALL answer api/feedback approved true with a Finish carrying feedback as notes. Other feedback SHALL create one Remark per code annotation with text and fenced suggestedCode, selector filePath with line or range unless file scope, lowercase type tag, and originalCode, selectedText or tokenText as anchor text. Each Remark SHALL preserve whole feedback. General text without annotations SHALL be one global_comment. Close SHALL finish with dismissed true. Commands SHALL retain Round refusals and draft clearing.

#### Scenario: Code comment reaches the holder
- **GIVEN** a listener holding the PR Review
- **WHEN** the page sends a comment on src/a.ts lines 3 to 5
- **THEN** it receives a feedback_item with selector src/a.ts:3-5 and tag comment

#### Scenario: Approve and stale commands
- **WHEN** the page sends approved true with notes
- **THEN** the holder receives finish with those notes
- **AND** another command for that ended Round answers 409 and writes nothing

### Requirement: Doors expose only PR review reads and Review writes
A door SHALL allow the PR page, diff, freshness, PR context, file expansion, diff images and existing draft, decision, Round and Reply routes. PR reads SHALL refuse file Reviews. Local checkout, repo and git-user fields SHALL be removed. External writes, PR actions, viewed updates, staging, open-in, agents, AI, config, upload, code navigation and switching SHALL answer 404. Visibility SHALL be checked per request.

#### Scenario: Phone loads and comments but cannot merge
- **GIVEN** a public PR Review
- **WHEN** its public door receives GET api/diff, POST api/feedback and POST api/pr-action
- **THEN** diff and feedback answer and pr-action answers 404
