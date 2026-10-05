## MODIFIED Requirements

### Requirement: Unversioned version discovery
The service SHALL answer `GET /api/review/version` with HTTP 200 and JSON `{ "major": <int>, "minor": <int> }`, at a path without a version, so a client can read any major and refuse one it does not support. This build SHALL answer major 1, minor 3, the minor raised since a Review can link a Multica issue.

#### Scenario: A client reads the major
- **GIVEN** the review service runs on 127.0.0.1
- **WHEN** a client sends `GET /api/review/version`
- **THEN** the answer is HTTP 200 with `{ "major": 1, "minor": 3 }`

#### Scenario: A Lavish plugin client accepts the service
- **GIVEN** the service runs and the `omp-lavish-review` `ReviewApi` client points at it
- **WHEN** the client runs its major check
- **THEN** the check passes, because the major is 1 and the extra `minor` field is ignored

## ADDED Requirements

### Requirement: A Review opens linked to a Multica issue
The open call SHALL take an optional `issue` object with `id` (a Multica issue key such as `WORK-167`, or its id) and `workspace_id` (the Multica workspace id), both stored trimmed. The Review SHALL store it and return it in the open answer. Opening again without `issue` SHALL keep the stored issue; opening with `issue` SHALL replace it. An `issue` that is not an object with nonblank string `id` and `workspace_id` SHALL be refused with 400 `issue requires nonempty id and workspace_id strings`, and an `issue` while `PLANNOTATOR_MULTICA_PROFILE` is unset or blank SHALL be refused with 400 `PLANNOTATOR_MULTICA_PROFILE is required to link an issue`; neither refusal opens or changes a Review. The Review list SHALL carry each Review's `issue`, or null.

#### Scenario: Opening with an issue links the Review
- **GIVEN** a service with `PLANNOTATOR_MULTICA_PROFILE` set
- **WHEN** a client opens a file with `issue` `{ "id": "WORK-1", "workspace_id": "W" }`
- **THEN** the answer and the Review list carry that `issue`

#### Scenario: Opening again keeps the issue
- **GIVEN** a Review linked to `WORK-1`
- **WHEN** a client opens its file without `issue`
- **THEN** the answer and the Review list still carry `WORK-1`

#### Scenario: Opening with another issue replaces it
- **GIVEN** a Review linked to `WORK-1`
- **WHEN** a client opens its file with `issue` `{ "id": "WORK-2", "workspace_id": "W" }`
- **THEN** the answer and the Review list carry `WORK-2`

#### Scenario: An unlinked Review lists null
- **GIVEN** a Review opened without `issue`
- **WHEN** a client lists the Reviews
- **THEN** its row carries `"issue": null`

#### Scenario: An issue without the setting is refused
- **GIVEN** a service without `PLANNOTATOR_MULTICA_PROFILE`
- **WHEN** a client opens a file with `issue`
- **THEN** the response is 400 naming `PLANNOTATOR_MULTICA_PROFILE`, and no Review is opened or changed

#### Scenario: An incomplete issue is refused
- **GIVEN** a running service
- **WHEN** a client opens a file with `issue` `{ "id": "WORK-1" }` or with a blank `workspace_id`
- **THEN** the response is 400, and no Review is opened or changed
