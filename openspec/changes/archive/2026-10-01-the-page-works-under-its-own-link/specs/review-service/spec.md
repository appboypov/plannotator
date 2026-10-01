## ADDED Requirements

### Requirement: A Review page works under its own link
A plan page served under a session path (`.../plannotator/session/<review_id>/`) SHALL send every call its client makes to a root API path (`/api/...` on the page's own host) through `fetch`, `EventSource`, `WebSocket` or an image source to the same path under its base, `<base>api/...`. The base SHALL be read from the page's location, so the page works on any origin that serves it. A page outside a session path SHALL keep upstream's root calls.

#### Scenario: The document renders and takes an annotation
- **GIVEN** the service runs and a Review is open for `plan.md`
- **WHEN** a browser loads the Review's link, selects text and saves a comment
- **THEN** the page shows `plan.md`'s content and the comment
- **AND** the network log holds `<base>api/plan` and `<base>api/draft` and no request to a root `/api/` path

#### Scenario: Absolute same-host and socket URLs are rebased
- **GIVEN** a page at `/plannotator/session/0123456789abcdef/`
- **WHEN** its client calls `http://<page host>/api/feedback` with a `Request` and opens `ws://<page host>/api/terminal`
- **THEN** the calls go to `http://<page host>/plannotator/session/0123456789abcdef/api/feedback` and `ws://<page host>/plannotator/session/0123456789abcdef/api/terminal`

#### Scenario: A plain annotate page is unchanged
- **GIVEN** a page at `/`
- **WHEN** its client fetches `/api/plan`
- **THEN** the request goes to `/api/plan`
