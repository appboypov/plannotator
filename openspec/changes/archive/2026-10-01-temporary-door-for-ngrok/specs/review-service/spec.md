## ADDED Requirements

### Requirement: The temporary door serves only temporary Reviews

The service SHALL run a temporary door on `127.0.0.1` that accepts connections only from `127.0.0.1`, SHALL answer only requests whose host is the host of `PLANNOTATOR_TEMPORARY_ORIGIN`, SHALL answer `/plannotator/health` and the page routes of a Review whose Visibility is `temporary` at the time of the request, and SHALL answer every other request, including the review API and every WebSocket upgrade, with HTTP 404, with framing forbidden on every answer. A `temporary` Review's link SHALL use `PLANNOTATOR_TEMPORARY_ORIGIN`.

#### Scenario: A temporary Review loads through ngrok

- **GIVEN** the service runs with its temporary door on 4398
- **AND** `ngrok http 4398` runs on the fixed address
- **AND** a Review is `temporary`
- **WHEN** a client opens its link with the `ngrok-skip-browser-warning` header
- **THEN** the page loads with HTTP 200 and `x-frame-options: DENY`

#### Scenario: A public or local Review is not served through ngrok

- **GIVEN** the service runs with its temporary door
- **AND** one Review is `public` and another `local`
- **WHEN** a client asks the temporary door for either page with the ngrok host
- **THEN** the answer is HTTP 404

#### Scenario: Only the link's host is answered

- **GIVEN** the service runs with its temporary door
- **AND** a Review is `temporary`
- **WHEN** a client asks the door for its page with the host `127.0.0.1:4398` or `ctas.de-appspecialist.nl`
- **THEN** the answer is HTTP 404

#### Scenario: A temporary Review made public closes its open page stream through the temporary door

- **GIVEN** a client has a temporary Review's Round stream open through the temporary door
- **WHEN** the Review's Visibility is set to `public`
- **THEN** the stream closes
- **AND** the page answers HTTP 404 through the temporary door

### Requirement: Doors open only when their port is set

`plannotator serve` SHALL open the public door only when `PLANNOTATOR_PUBLIC_PORT` names a port and the temporary door only when `PLANNOTATOR_TEMPORARY_PORT` names a port; unset or `off` SHALL open no door. `plannotator service install` SHALL write the live doors into the LaunchAgent (public `100.111.186.85:4399` for peer `100.67.134.112`, temporary port `4398`) and SHALL let a setting in the installing environment replace each of them.

#### Scenario: Serve run by hand opens no door

- **GIVEN** no door setting in the environment
- **WHEN** Brian runs `plannotator serve --port 4497`
- **THEN** it listens on `127.0.0.1:4497` only

#### Scenario: The LaunchAgent runs both live doors

- **GIVEN** an installing shell without door settings
- **WHEN** `plannotator service install` runs
- **THEN** the service listens on `127.0.0.1:4397`, `100.111.186.85:4399` and `127.0.0.1:4398`

#### Scenario: The installing shell turns a door off

- **GIVEN** `PLANNOTATOR_PUBLIC_PORT=off` in the installing shell
- **WHEN** `plannotator service install` writes the plist
- **THEN** the plist carries `PLANNOTATOR_PUBLIC_PORT` `off` and `PLANNOTATOR_TEMPORARY_PORT` `4398`
