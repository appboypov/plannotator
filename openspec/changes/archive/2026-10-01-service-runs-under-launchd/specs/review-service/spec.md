## ADDED Requirements

### Requirement: The service runs under launchd

`plannotator service install` SHALL install the running compiled binary at `~/.local/bin/plannotator` and load the LaunchAgent `nl.de-appspecialist.plannotator`, which runs `plannotator serve` at login, keeps it alive and restarts it when it exits, with logs under `~/Library/Logs/plannotator/`. Install SHALL replace a loaded service and succeed only when health answers with the binary's version and the LaunchAgent's label. `service uninstall` SHALL unload it and remove its plist; `service status` SHALL show launchd's state and the service's health.

#### Scenario: Install starts the service

- **GIVEN** a binary built with `bun fork/build-binary.ts`
- **WHEN** Brian runs `fork/dist/plannotator service install`
- **THEN** `launchctl print gui/$UID/nl.de-appspecialist.plannotator` shows it running
- **AND** `curl 127.0.0.1:4397/plannotator/health` answers 200 with the version `plannotator --version` prints and `service.label` `nl.de-appspecialist.plannotator`

#### Scenario: A killed service comes back

- **GIVEN** the service runs under launchd
- **WHEN** its process is killed
- **THEN** launchd starts a new process and health answers 200 again

#### Scenario: Install from source changes nothing

- **GIVEN** `plannotator` run from source with Bun
- **WHEN** `service install` runs
- **THEN** it exits 1 naming the build command, and no binary or plist is written

#### Scenario: Another server on the port fails the install

- **GIVEN** a server launchd does not run answers on 4397
- **WHEN** `service install` runs
- **THEN** it exits 1 naming what answers and the log file

## MODIFIED Requirements

### Requirement: The service answers health and version
`GET /plannotator/health` SHALL answer HTTP 200 `{ "ok": true, "app": "plannotator", "version": <build version>, "api": { "major": 1, "minor": 0 } }` while the service runs, adding `"service": { "label": <LaunchAgent label> }` when `PLANNOTATOR_SERVICE_LABEL` names the LaunchAgent that runs it, and `GET /api/review/version` SHALL answer `{ "major": 1, "minor": 0 }`. Every route SHALL apply the contract's Host and Origin rule (HTTP 403 `forbidden`).

#### Scenario: Health answers while the service runs
- **GIVEN** `plannotator serve` runs on a dev port
- **WHEN** a client sends `GET /plannotator/health`
- **THEN** the answer is HTTP 200 with `ok` true and API major 1

#### Scenario: Health names the LaunchAgent
- **GIVEN** launchd runs the service as `nl.de-appspecialist.plannotator`
- **WHEN** a client sends `GET /plannotator/health`
- **THEN** the answer carries `service.label` `nl.de-appspecialist.plannotator`

#### Scenario: A foreign page cannot open a Review
- **GIVEN** the service runs
- **WHEN** a request with `Origin: https://evil.example` posts an open request
- **THEN** the answer is HTTP 403 and no Review is created
