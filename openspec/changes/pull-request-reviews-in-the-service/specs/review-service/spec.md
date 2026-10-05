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

## MODIFIED Requirements

### Requirement: The Review page is upstream's plan page under its own path
The service SHALL serve each Review's page at `/plannotator/session/<review_id>/` by forwarding `/plannotator/session/<review_id>/<rest>` to `/<rest>` on an upstream page server. A document uses the annotate server with the plan page; a PR uses the code review server with the review page. The page SHALL start on first request and remain for its Round. `GET /plannotator/session/<review_id>/api/plan` for a document SHALL answer upstream's plan payload whose `plan` is the file content. A page path without its trailing slash SHALL redirect (308) to the path with it. An unknown id SHALL answer HTTP 404 `{ "error": "review not found" }`. A page whose server cannot start SHALL answer HTTP 502 `{ "error": "page failed to start: <reason>" }` and SHALL be tried again on the next request.

#### Scenario: Each page returns its own document
- **GIVEN** the service opened `plan.md` as Review `a` and `brief.md` as Review `b`
- **WHEN** a client sends `GET /plannotator/session/a/api/plan` and `GET /plannotator/session/b/api/plan`
- **THEN** both answer HTTP 200, the first with `plan.md` content as `plan` and the second with `brief.md` content

#### Scenario: Loading the page is listed
- **GIVEN** an open Review whose page is not loaded
- **WHEN** a browser loads `/plannotator/session/<review_id>/`
- **THEN** the answer is its subject's page HTML and the list shows the Review's `last_page_open` as that time

### Requirement: The service answers health and version
`GET /plannotator/health` SHALL answer HTTP 200 `{ "ok": true, "app": "plannotator", "version": <build version>, "api": { "major": 1, "minor": 2 } }` while the service runs, adding `"service": { "label": <LaunchAgent label> }` when `PLANNOTATOR_SERVICE_LABEL` names the LaunchAgent that runs it, and `GET /api/review/version` SHALL answer `{ "major": 1, "minor": 2 }`. Every route SHALL apply the contract's Host and Origin rule (HTTP 403 `forbidden`).

#### Scenario: Health answers while the service runs
- **GIVEN** `plannotator serve` runs on a dev port
- **WHEN** a client sends `GET /plannotator/health`
- **THEN** the answer is HTTP 200 with `ok` true and API major 1 and minor 2

#### Scenario: Health names the LaunchAgent
- **GIVEN** launchd runs the service as `nl.de-appspecialist.plannotator`
- **WHEN** a client sends `GET /plannotator/health`
- **THEN** the answer carries `service.label` `nl.de-appspecialist.plannotator`

#### Scenario: A foreign page cannot open a Review
- **GIVEN** the service runs
- **WHEN** a request with `Origin: https://evil.example` posts an open request
- **THEN** the answer is HTTP 403 and no Review is created

### Requirement: Replies and Round state show on the page
A document Review page SHALL list, in its annotation panel, the Remarks the reviewer sent in every Round, read-only and apart from the draft, each with the agents' Replies under it, and SHALL never send a listed Remark again. Every Review page SHALL show the Round number when its Round is finished, cancelled, or replaced by a later Round; a page from an earlier Round SHALL NOT act on the current one. A page covered because its Round ended SHALL replace that cover when a later Round opens. Listing sent Remarks and Replies in the code review UI is outside this requirement.

#### Scenario: A Reply shows under the Remark it answers
- **GIVEN** a document Review page where the reviewer sent the Remark "Please tighten the heading."
- **WHEN** an agent replies "Tightened it." to that Remark and the reviewer reloads the page
- **THEN** the annotation panel lists the Remark under "Sent", stamped "Round 1"
- **AND** the Reply "Tightened it." shows under it, labelled "Reply"
- **AND** the Remark has no edit or delete control

#### Scenario: Sent Remarks are not sent again
- **GIVEN** a document Review page listing a sent Remark
- **WHEN** the reviewer adds a comment and sends feedback
- **THEN** the service stores one Remark for that comment

#### Scenario: A finished Round shows as finished
- **GIVEN** a Review whose reviewer approved round 1
- **WHEN** the page is loaded
- **THEN** the page is covered with "Round 1 is finished"

#### Scenario: A stale tab cannot send to the next Round
- **GIVEN** a tab loaded in round 1 whose Round stream delivers nothing
- **WHEN** the agent reopens the Review into round 2 and the tab sends feedback
- **THEN** the service answers 409 `stale-round` and stores nothing
- **AND** the tab is covered with "Round 2 is open" and offers a reload

#### Scenario: An agent's Cancel covers the open page
- **GIVEN** a Review page open in round 1
- **WHEN** the agent cancels the Review
- **THEN** the page is covered with "Round 1 was cancelled" without a reload
- **AND** after a reload it is still covered with "Round 1 was cancelled"

#### Scenario: An ended Round's cover gives way to the next Round
- **GIVEN** a tab covered with "Round 1 was cancelled"
- **WHEN** the agent reopens the Review into round 2
- **THEN** the tab's one cover reads "Round 2 is open" and offers a reload
