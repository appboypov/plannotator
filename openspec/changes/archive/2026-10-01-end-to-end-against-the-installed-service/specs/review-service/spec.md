## ADDED Requirements

### Requirement: An end-to-end suite proves the installed service

`bun test ./fork/e2e/service.e2e.ts` SHALL run against the installed service (the LaunchAgent on 127.0.0.1:4397, `~/.local/bin/plannotator`, the public door behind `https://ctas.de-appspecialist.nl/plannotator/`) and SHALL prove: two documents open at once, a Remark sent while no one listens reaches a later listener, `plannotator annotate --gate --json` returns approved when the page approves, and the public door refuses a local Review. Each scenario SHALL use scratch files and cancel its Reviews after. The suite SHALL NOT be picked up by `bun test`'s default globs and SHALL never skip.

#### Scenario: The suite passes on the installed service

- **GIVEN** `plannotator service install` has installed and started the service
- **WHEN** `bun test ./fork/e2e/service.e2e.ts` runs
- **THEN** every scenario passes

#### Scenario: The suite fails when the service is stopped

- **GIVEN** the LaunchAgent is booted out and nothing answers on 4397
- **WHEN** `bun test ./fork/e2e/service.e2e.ts` runs
- **THEN** every scenario fails and none is skipped
