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

### Requirement: Remarks carry the page's feedback text

Each Remark of a Send feedback SHALL carry the page's `feedback` text as `feedback` when the page sent one. A Send feedback with that text and no annotations SHALL store one `global_comment` Remark whose `text` and `feedback` are the text; a send with neither SHALL store nothing.

#### Scenario: Annotations with the page's text

- **GIVEN** an open Review
- **WHEN** the reviewer sends two annotations and the page's text
- **THEN** two Remarks are stored and each carries the page's text as `feedback`

#### Scenario: Only question answers

- **GIVEN** an open Review
- **WHEN** the page sends feedback text and no annotations
- **THEN** one `global_comment` Remark is stored with that text

#### Scenario: Nothing sent

- **GIVEN** an open Review
- **WHEN** the page sends no annotations and empty text
- **THEN** no Remark is stored
