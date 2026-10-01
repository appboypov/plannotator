## ADDED Requirements

### Requirement: Close is told apart from Approve

The Finish notice of a Close (`api/exit`) SHALL carry `dismissed: true`; an Approve's Finish SHALL NOT carry it. The field SHALL be stored with the notice and kept on replay.

#### Scenario: Close finishes dismissed

- **GIVEN** an open Review with a listener
- **WHEN** the reviewer closes the page
- **THEN** the listener receives a `finish` with `notes: ""` and `dismissed: true`

#### Scenario: Approve without notes is not dismissed

- **GIVEN** an open Review with a listener
- **WHEN** the reviewer approves without notes
- **THEN** the listener receives a `finish` with `notes: ""` and no `dismissed`
