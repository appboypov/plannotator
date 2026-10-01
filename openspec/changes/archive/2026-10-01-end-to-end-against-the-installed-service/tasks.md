## 1. Suite

- [x] 1.1 `fork/e2e/service.e2e.ts`: health names the LaunchAgent and the installed binary's version; verified by a live run
- [x] 1.2 Two documents open at once, each page and `api/plan` its own document; verified by a live run
- [x] 1.3 A Remark sent while no one listens reaches a later listener (replayed before `subscribed`); verified by a live run
- [x] 1.4 `plannotator annotate --gate --json` prints `{"decision":"approved"}` after the page's Approve; verified by a live run
- [x] 1.5 The public door: 404 for a local Review, 200 once public, 404 once local again; verified by a live run
- [x] 1.6 Scratch files per scenario, Reviews cancelled after; verified by the service's list after a run (only cancelled or finished e2e Reviews)

## 2. Docs and verify

- [x] 2.1 `fork/README.md` "End-to-end against the installed service"
- [x] 2.2 `bun test fork/e2e` finds no test file (outside the default globs)
- [x] 2.3 With the LaunchAgent booted out the suite fails with no skip; restored with `fork/dist/plannotator service install`, health 200 and both doors answer
