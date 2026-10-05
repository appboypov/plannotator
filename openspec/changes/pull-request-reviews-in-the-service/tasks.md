## 1. Subjects and API

- [x] 1.1 Accept, canonicalize, persist and list PR URL subjects; serve API 1.2.

## 2. PR pages and decisions

- [x] 2.1 Start one upstream PR review page per Round with auth and fetch.
- [x] 2.2 Install page-base and Round closure glue in the code review entry.
- [x] 2.3 Map code annotations, Approve and Close with Round checks and draft clearing.
- [x] 2.4 Allow PR read routes through doors and strip local paths.

## 3. CLI

- [x] 3.1 Generalize annotate transport and route plain PR review calls through it.

## 4. Documentation and proof

- [x] 4.1 Document subjects, decisions, doors and CLI; record ADR 0009.
- [x] 4.2 Cover URL subjects, mapping, routing, doors and CLI with focused tests.
- [x] 4.3 Run focused tests, fork check and isolated real-PR smoke.

## Implementation Notes

The service reuses the upstream PR parser, review server, embedded HTML and review output formatter.

The code review surface fixes its decision destination to the service listener and omits provider destination controls under a session path. The PR context stream is a door read because the rendered page loads context through SSE.

Verification uses Bun 1.3.14, the runtime pinned by the upstream workflow. The focused contract tests pass. The fork check reaches its test step with 5810 passing tests, 1305 skipped tests and the opencode-plugin directory-selection timeout that also occurs on main. The remaining fork steps pass when run separately. The isolated service opens PR 22 as Review `14083d67dcb8ca66`, serves its code review page and diff, delivers a code Remark and finishes on browser Approve. The CLI reopens Round 2 and prints an approved JSON result with notes. The smoke service and listener are stopped.
