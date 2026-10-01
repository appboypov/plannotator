## MODIFIED Requirements

### Requirement: plannotator annotate goes through the review service

`plannotator annotate <file>` on a local file SHALL open or reopen the file's Review in the running review service on the port in `PLANNOTATOR_SERVICE_PORT`, else 4397, print its link, wait for the Round's end over the listen socket with its own session id, acknowledge the notice it ends on and print the outcome in upstream's shape. Calls on different files SHALL run at once. URLs, folders, raw HTML (a local `.html` file or `--render-html`), `--markdown`, live apps and `--tailscale` SHALL keep upstream's one-shot server.

#### Scenario: Approve in the browser

- **GIVEN** the service runs
- **WHEN** `plannotator annotate plan.md --gate --json` runs and the reviewer approves on the page
- **THEN** the command prints `{"decision":"approved"}` and the Finish notice is acknowledged

#### Scenario: Close the page

- **GIVEN** an annotate call waits on its Round
- **WHEN** the reviewer closes the page without sending
- **THEN** the command prints `{"decision":"dismissed"}`

#### Scenario: Send feedback

- **GIVEN** an annotate call waits on its Round
- **WHEN** the reviewer sends feedback on the page
- **THEN** the call cancels the Round and prints `annotated` with the page's feedback text
- **AND** the next call on the file opens the next Round on the same link

#### Scenario: Feedback, then Approve before the call's Cancel

- **GIVEN** an annotate call waits on its Round
- **WHEN** the reviewer sends feedback and approves before the call cancels the Round
- **THEN** the command prints `annotated` with the feedback, not `approved`

#### Scenario: Two files at once

- **GIVEN** the service runs
- **WHEN** annotate calls on two different files run at the same time
- **THEN** both Reviews are open with one listener each and each call ends on its own Review's Round

#### Scenario: Another agent cancels the Round

- **GIVEN** an annotate call waits on its Round and no Remarks arrived
- **WHEN** another agent cancels the Review
- **THEN** the call fails naming the Round and the link

#### Scenario: No service

- **GIVEN** nothing answers on the service's port
- **WHEN** `plannotator annotate plan.md` runs
- **THEN** it fails with a message naming `plannotator serve` and `PLANNOTATOR_SERVICE_PORT`, without starting a page of its own

#### Scenario: A local HTML file keeps its raw HTML view

- **WHEN** `plannotator annotate page.html` runs
- **THEN** upstream's one-shot server serves the raw HTML view and no Review is opened in the service
