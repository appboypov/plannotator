## ADDED Requirements

### Requirement: Rounds, Approve, Cancel and list

The service SHALL finish a Review's Round when the reviewer approves or closes its page, recording a Finish notice with the page's notes; SHALL cancel the Round on an agent's Cancel, recording a Cancel notice; SHALL replay pending notices to listeners until acknowledged; SHALL open the next Round on the same link when a cancelled Review, or a finished one with `reopen`, is opened; SHALL refuse a page command for a Round that is not open with HTTP 409; and SHALL list each Review with its state and Round.

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
- **THEN** listeners receive a `cancel` notice and the page's Round stream reports `cancelled`
- **AND** a page command answers 409 `ended` with `ended_by` `agent`

#### Scenario: A stale Round is refused

- **GIVEN** a Review in round 2
- **WHEN** the page sends feedback for round 1
- **THEN** the service answers 409 `stale-round` with round 2 and stores nothing
