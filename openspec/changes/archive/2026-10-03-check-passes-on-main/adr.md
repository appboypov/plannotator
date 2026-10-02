# ADR Review Manifest

- Status: completed
- Review date: 2026-10-03

## Review Summary

ADR review completed for this change.

## In-Force ADRs Reviewed

- ADR 0001 (record architecture decisions): no decision of this change meets its bar.
- ADR 0003 (fork-owned code and checks): the check stays `fork/ci-check.ts` running the `run` steps of upstream's `test.yml`; the edits to the upstream files `.github/workflows/test.yml`, `packages/shared/review-core.test.ts` and `apps/pi-extension/server/network.test.ts` are a few test lines each, the smallest that make the check pass.
- ADR 0002 (WebTUI agent panel), ADR 0004 (review API v1 matches Lavish), ADR 0005 (one upstream annotate server per Review), ADR 0006 (the service answers the page decisions), ADR 0007 (annotate is a client of the service; doors serve only their Visibility), ADR 0008 (one listener holds each Review): unchanged; this change touches tests and the CI step list only.

## New Durable ADRs Created

- None - no major durable architectural decisions were introduced.
