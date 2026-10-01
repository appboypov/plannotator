## 1. Service

- [x] 1.1 Close's Finish notice carries `dismissed: true`; stored and replayed
- [x] 1.2 `resolveServicePort` reads `PLANNOTATOR_SERVICE_PORT`, else 4397, refuses 0

## 2. CLI

- [x] 2.1 `annotate-service.ts`: version check, open with `reopen`, listen per call, outcome per Round end, ack and exit barrier, reconnect
- [x] 2.2 Call site in `index.ts` for a plain local file; clear error with no service
- [x] 2.3 Tests: Approve with notes and ack, Close, Send feedback with the next Round, reopen after Approve, two files at once, another agent's Cancel, no service

## 3. Docs and proof

- [x] 3.1 `docs/review-api.md`, `fork/README.md`, ADR 0007
- [x] 3.2 Smoke: two real calls at once on the dev service, Approve in a real browser prints `{"decision":"approved"}`
