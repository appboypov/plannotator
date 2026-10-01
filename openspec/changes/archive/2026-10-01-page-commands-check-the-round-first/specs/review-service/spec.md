## ADDED Requirements

### Requirement: A refused page command keeps the open Round's draft

The service SHALL check a page command's Round against the Review as it is once the command's body has arrived, before clearing any draft, so a command refused with HTTP 409 SHALL leave the page's draft untouched.

#### Scenario: A slow round 1 command after the next Round opened

- **GIVEN** an open Review in round 1 and a Send feedback for round 1 whose body is slow
- **WHEN** the agent cancels and reopens the Review into round 2 and the reviewer saves a round 2 draft before the body arrives
- **THEN** the command answers 409 `stale-round`
- **AND** the round 2 draft is still there and no Remark is stored
