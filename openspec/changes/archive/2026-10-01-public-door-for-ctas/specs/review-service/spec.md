## ADDED Requirements

### Requirement: The public door serves only public Reviews

The service SHALL run a public door that accepts connections only from its configured peer, SHALL answer `/plannotator/health` and the page routes of a Review whose Visibility is `public` at the time of the request, and SHALL answer every other request, including the review API, with HTTP 404, with framing forbidden on every answer.

#### Scenario: A public Review loads through ctas

- **GIVEN** the service runs with its public door
- **AND** a Review is `public`
- **WHEN** a client opens `https://ctas.de-appspecialist.nl/plannotator/session/<review_id>/`
- **THEN** the page loads with HTTP 200 and `x-frame-options: DENY`

#### Scenario: A local Review stays on this Mac

- **GIVEN** the service runs with its public door
- **AND** a Review is `local`
- **WHEN** a client asks the public door for that Review's page
- **THEN** the answer is HTTP 404

#### Scenario: The review API is not reachable through the door

- **GIVEN** the service runs with its public door
- **WHEN** a client asks the door for `/api/review/v1/reviews`
- **THEN** the answer is HTTP 404

#### Scenario: Another address cannot connect

- **GIVEN** the public door accepts only the VPS
- **WHEN** another address connects to the door
- **THEN** the connection is dropped before any answer

#### Scenario: A Review made local closes its open page stream

- **GIVEN** a client has a public Review's Round stream open through the door
- **WHEN** the Review's Visibility is set to `local`
- **THEN** the stream closes
- **AND** the page answers HTTP 404 through the door
