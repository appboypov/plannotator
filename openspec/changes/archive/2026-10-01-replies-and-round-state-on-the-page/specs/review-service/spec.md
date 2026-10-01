## ADDED Requirements

### Requirement: Replies and Round state show on the page

A Review page SHALL list, in its annotation panel, the Remarks the reviewer sent in every Round, read-only and apart from the draft, each with the agents' Replies under it; SHALL never send a listed Remark again; and SHALL show the Round number when its Round is finished, cancelled, or replaced by a later Round, and a page from an earlier Round SHALL NOT act on the current one.

#### Scenario: A Reply shows under the Remark it answers

- **GIVEN** a Review page where the reviewer sent the Remark "Please tighten the heading."
- **WHEN** an agent replies "Tightened it." to that Remark and the reviewer reloads the page
- **THEN** the annotation panel lists the Remark under "Sent", stamped "Round 1"
- **AND** the Reply "Tightened it." shows under it, labelled "Reply"
- **AND** the Remark has no edit or delete control

#### Scenario: Sent Remarks are not sent again

- **GIVEN** a Review page listing a sent Remark
- **WHEN** the reviewer adds a comment and sends feedback
- **THEN** the service stores one new Remark, the new comment

#### Scenario: A finished Round shows as finished

- **GIVEN** a Review whose reviewer approved round 1
- **WHEN** the page is loaded
- **THEN** the page is covered with "Round 1 is finished"

#### Scenario: A stale tab cannot send to the next Round

- **GIVEN** a tab loaded in round 1 whose Round stream delivers nothing
- **WHEN** the agent reopens the Review into round 2 and the tab sends feedback
- **THEN** the service answers 409 `stale-round` and stores nothing
- **AND** the tab is covered with "Round 2 is open" and offers a reload
