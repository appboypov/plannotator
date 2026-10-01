## ADDED Requirements

### Requirement: The fork's README tells how to install and open a document

The root `README.md` SHALL begin with a short fork notice that points to `fork/README.md` and `docs/invariants.md` and SHALL keep upstream's text unchanged below it. `fork/README.md` SHALL be the single source for the fork's user-facing service: how to install the service on this Mac, how to open a Markdown document (through `plannotator annotate` and through the review API), its doors and ports with who may connect to each, Visibility, a summary of the review API that points to `docs/review-api.md`, every setting with its default, the launchd commands and logs, and how to update from upstream.

#### Scenario: A fresh reader installs and opens a document

- **GIVEN** a reader with only the repository's README and `fork/README.md`
- **WHEN** they follow "Install and open a document" on this Mac
- **THEN** `curl 127.0.0.1:4397/plannotator/health` answers 200 with the LaunchAgent's label
- **AND** opening a Markdown file the documented way prints its link, and loading that link shows the document

#### Scenario: Upstream's README stays mergeable

- **GIVEN** the root `README.md`
- **WHEN** an upstream release is merged
- **THEN** only the fork notice above upstream's first line can conflict

### Requirement: The invariants name every port and who may connect

`docs/invariants.md` SHALL name every listener of the service (the service port, the public door, the temporary door and the per-Review page servers) with its address, who may connect to it and what enforces that, and SHALL state the rules that are easy to break: doors open only under launchd, the review API is never behind a door, a door serves only its Visibility per request, state has one owning process, and the installed binary is what runs.

#### Scenario: Every live listener is in the invariants

- **GIVEN** the LaunchAgent's process
- **WHEN** its listening sockets are listed with `lsof -iTCP -sTCP:LISTEN`
- **THEN** each one is a port `docs/invariants.md` names, with who may connect to it
