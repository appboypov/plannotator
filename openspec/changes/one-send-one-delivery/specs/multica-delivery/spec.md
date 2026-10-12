## MODIFIED Requirements

### Requirement: A linked Review posts each Remark to its issue
The service SHALL post each Send feedback of a Review linked to a Multica issue as one top-level comment on that issue, as the member of the Multica CLI profile `PLANNOTATOR_MULTICA_PROFILE` names. The poster SHALL select the next pending record in store order; a Remark with `batch_id` SHALL gather every still-pending Remark of that Review with the same identity in store order, and a legacy Remark SHALL post alone. The comment SHALL hold each remark's quoted text, item id and anchor (kind, block and excerpt, or the whole page), a header naming the Round, Link and count for multiple Remarks, and one closing `plannotator_reply` instruction with every item id and the Review id. A one-Remark batch SHALL retain the existing comment text. Reviewer words and anchors SHALL not form a Multica mention. Every gathered Remark SHALL be marked posted with the same comment id in one atomic file replacement, guarded against a destination moved during the post. Approve and Close SHALL remain separate comments.

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
- **THEN** the issue gets one comment containing all three Remarks in store order and all three item ids in one reply instruction

#### Scenario: Legacy Remarks and separate sends
- **GIVEN** two pending legacy Remarks and two pending sends with distinct batch identities
- **WHEN** the poster drains the Review
- **THEN** each legacy Remark posts alone and each send posts once

#### Scenario: Only pending batch members are posted
- **GIVEN** a batch with one posted Remark and two pending Remarks
- **WHEN** the poster drains the Review
- **THEN** one comment contains only the two pending Remarks and both retain the same new comment id
