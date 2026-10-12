## MODIFIED Requirements

### Requirement: The service answers health and version
`GET /plannotator/health` SHALL answer HTTP 200 `{ "ok": true, "app": "plannotator", "version": <build version>, "api": { "major": 1, "minor": 4 } }` while the service runs, adding `"service": { "label": <LaunchAgent label> }` when `PLANNOTATOR_SERVICE_LABEL` names the LaunchAgent that runs it, and `GET /api/review/version` SHALL answer `{ "major": 1, "minor": 4 }`. Every route SHALL apply the contract's Host and Origin rule (HTTP 403 `forbidden`).

#### Scenario: Health answers while the service runs
- **GIVEN** `plannotator serve` runs on a dev port
- **WHEN** a client sends `GET /plannotator/health`
- **THEN** the answer is HTTP 200 with `ok` true and API major 1 and minor 4

#### Scenario: Health names the LaunchAgent
- **GIVEN** launchd runs the service as `nl.de-appspecialist.plannotator`
- **WHEN** a client sends `GET /plannotator/health`
- **THEN** the answer carries `service.label` `nl.de-appspecialist.plannotator`

#### Scenario: A foreign page cannot open a Review
- **GIVEN** the service runs
- **WHEN** a request with `Origin: https://evil.example` posts an open request
- **THEN** the answer is HTTP 403 and no Review is created
