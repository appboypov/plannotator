# multica-delivery Specification

## Purpose
A Review linked to a Multica issue posts each Remark, Approve and Close as a comment on that issue, durably and in order, and its records reach no listener. Code: `packages/server/review-service/multica-poster.ts`; decision: ADR-0010 in `omp-lavish-review`.

## Requirements

### Requirement: A linked Review posts each Remark to its issue
The service SHALL post each Remark of a Review linked to a Multica issue as one top-level comment on that issue, as the member of the Multica CLI profile `PLANNOTATOR_MULTICA_PROFILE` names. The comment SHALL hold the remark text, the item id, the anchor (kind, block and excerpt, or the whole page when the anchor is empty), the Review id, the Round, the Review's Link and how to answer with `plannotator_reply`. The remark text SHALL not form a Multica mention.

#### Scenario: A page Remark becomes a comment
- **GIVEN** a Review opened with issue `WORK-1` in workspace `W`
- **WHEN** the reviewer sends a comment on a block
- **THEN** within seconds `WORK-1` has a top-level comment by the profile's member with the remark text, the item's `fi_` id, the annotation kind, the block id and its excerpt, the Review id, Round 1 and the Link

#### Scenario: Remark text cannot mention
- **GIVEN** a linked Review
- **WHEN** the reviewer sends a remark holding `[@x](mention://agent/<id>)`
- **THEN** the comment shows the text, and `mention://` does not appear in its content as one contiguous token

#### Scenario: Several Remarks post in order
- **GIVEN** a linked Review
- **WHEN** the reviewer sends three annotations in one Send feedback
- **THEN** the issue gets three comments, in the order the Remarks were stored

### Requirement: A linked Review posts its Approve and Close
The service SHALL post the Approve and the Close of a linked Review as one top-level comment each on its issue, holding the Round, the notice id, the Review id and the Link, and for an Approve its notes when it has any. Posting a notice SHALL acknowledge it. An agent's Cancel SHALL not be posted.

#### Scenario: An Approve becomes a comment
- **GIVEN** a linked Review in Round 1
- **WHEN** the reviewer approves it with notes
- **THEN** within seconds its issue has a comment that Round 1 is approved, with the notes, the `nt_` id and the Review id, and the notice is acknowledged

#### Scenario: A Close becomes a comment
- **GIVEN** a linked Review in Round 1
- **WHEN** the reviewer closes the page without approving
- **THEN** within seconds its issue has a comment that Round 1 is closed without approving, with the `nt_` id

#### Scenario: A Cancel stays off the issue
- **GIVEN** a linked Review
- **WHEN** an agent cancels it
- **THEN** its issue gets no comment

### Requirement: Delivery to Multica is durable
Each posted record of a linked Review SHALL carry a delivery state in the Review's folder: the issue and workspace it goes to, pending or posted, and once posted the time and the comment id when the answer has one. Any 2xx answer SHALL count as posted. A Review's records SHALL post one at a time in store order. A failed post SHALL stay pending and retry with a growing wait of at most five minutes, holding only its own Review's later records. A started service SHALL post every pending record. A posted record SHALL not be posted again. An open with `issue` SHALL move the Review's pending records to that issue, and SHALL enroll the Review's open Remarks that no listener received and the pending Approve or Close of the Round the Review is in after the open; received or answered Remarks, an earlier Round's Approve or Close, acknowledged notices and Cancels SHALL stay off it.

#### Scenario: A failed post retries
- **GIVEN** a linked Review and a Multica server that refuses the first post
- **WHEN** the reviewer sends a Remark
- **THEN** the Remark stays pending, and a later attempt posts it once

#### Scenario: A restart posts what is pending
- **GIVEN** a stored linked Remark still pending when the service stopped
- **WHEN** the service starts
- **THEN** it posts the Remark, and the Remark is posted with its comment id

#### Scenario: Opening with the right issue frees a stuck record
- **GIVEN** a linked Review whose pending Remark fails because its issue key does not exist
- **WHEN** a client opens the file again with an existing issue
- **THEN** the Remark posts to the new issue

#### Scenario: A Remark left before the link is posted once the Review is linked
- **GIVEN** a Review opened without `issue` and an open Remark the reviewer sent on it
- **WHEN** a client opens the file again with issue `WORK-1`
- **THEN** `WORK-1` gets a comment holding that Remark, and a Remark already answered before the link gets none

#### Scenario: A Remark a listener received stays with that listener
- **GIVEN** a Review opened without `issue` and an open Remark a listener received
- **WHEN** a client opens the file again with issue `WORK-1`
- **THEN** `WORK-1` gets no comment for that Remark

#### Scenario: The log holds no remark text
- **GIVEN** a linked Review
- **WHEN** a post succeeds or fails
- **THEN** the log line holds the Review id, the record id, the kind and the HTTP status, and no remark text, file path or token

### Requirement: A linked Review's events reach no listener
The Remarks and notices of a linked Review SHALL go to its issue only: no listen socket SHALL receive them, live, on a subscription's replay or by hand-over, and its `listeners` in the list SHALL be empty. Reviews without an issue keep ADR 0008.

#### Scenario: A listener to all Reviews does not hear a linked Review
- **GIVEN** a session subscribed to all Reviews and a Review linked to an issue
- **WHEN** the reviewer sends a Remark on the linked Review
- **THEN** the session receives no `feedback_item`, and the issue gets the comment
