## ADDED Requirements

### Requirement: Replies on a Remark

The service SHALL store an agent's Reply in the Review's folder, SHALL mark each Remark it names `answered` so no later subscription replays it, SHALL refuse a Reply naming a Remark the Review does not have with HTTP 400 and write nothing, and SHALL answer the Review page's `api/review-replies` with every Remark and the Replies that name it, also after a restart and on an ended Round.

#### Scenario: A Reply shows under its Remark after a restart

- **GIVEN** a Review with a Remark sent from its page
- **WHEN** an agent posts a Reply answering that Remark
- **AND** the service restarts
- **THEN** `GET <link>api/review-replies` returns the Remark with status `answered` and that Reply under it

#### Scenario: An answered Remark is not replayed

- **GIVEN** a Review with two Remarks and a Reply answering the first
- **WHEN** a new listener subscribes to the Review
- **THEN** it receives only the second Remark

#### Scenario: A Reply naming an unknown Remark writes nothing

- **GIVEN** a Review with one Remark
- **WHEN** an agent posts a Reply naming that Remark and an id the Review does not have
- **THEN** the answer is HTTP 400 `unknown feedback items` naming the unknown id
- **AND** the page route shows the Remark open without Replies

#### Scenario: An ended Review takes a Reply naming no Remark

- **GIVEN** a cancelled Review
- **WHEN** an agent posts a Reply without `answers`
- **THEN** the answer is HTTP 200 with `answered` empty
- **AND** the page route lists that Reply among the Replies naming no Remark
