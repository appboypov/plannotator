## ADDED Requirements

### Requirement: Metadata saves keep the latest Round

The service SHALL save a Visibility change or a page load's `last_page_open` onto the Review as it is when the save happens, so a Cancel, Approve or reopen that landed while the request was in flight SHALL stand.

#### Scenario: A slow Visibility body after a Cancel

- **GIVEN** an open Review
- **WHEN** a Visibility request's body arrives after the agent cancelled the Review
- **THEN** the Review is `cancelled` with the new visibility

#### Scenario: A slow page load after a Cancel

- **GIVEN** an open Review whose page is loading
- **WHEN** the agent cancels before the page's HTML arrives
- **THEN** the Review stays `cancelled` and records `last_page_open`
