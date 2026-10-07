# review-command Specification

## Purpose
The `plannotator review` command for a pull request URL: a plain run is a client of the always-on review service, which opens the PR Review, opens its page and prints the reviewer's decision.

## Requirements

### Requirement: Plain PR review is a service client
plannotator review with only a PR URL and optional --json SHALL open or reopen its Review in the running service, open its local link unless PLANNOTATOR_SKIP_BROWSER_OPEN is 1, and wait on the listen socket with its own session. It SHALL print upstream review output: Approve with notes, feedback with its formatted text, or dismissal. Feedback SHALL cancel the Round and answer taken Remarks before leaving. An unavailable service SHALL fail naming plannotator serve without fallback. Other targets and mode flags SHALL retain upstream one-shot review.

#### Scenario: Feedback finishes one CLI call
- **GIVEN** a plain PR review call waiting in a Round
- **WHEN** code feedback arrives
- **THEN** it cancels the Round, answers its Remarks and prints annotated output

#### Scenario: Approval produces JSON
- **GIVEN** a plain PR review call with --json
- **WHEN** Approve carries notes
- **THEN** it prints upstream approved JSON containing those notes
