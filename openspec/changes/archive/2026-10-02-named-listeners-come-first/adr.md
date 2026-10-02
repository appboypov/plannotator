# ADR Review Manifest

- Status: completed
- Review date: 2026-10-02

## Review Summary

ADR review completed for this change.

## In-Force ADRs Reviewed

- ADR 0001 (record architecture decisions): this change records ADR 0008.
- ADR 0003 (fork-owned code and checks): every edit is in fork-owned modules (`packages/server/review-service/`, `packages/shared/review-api/`, `docs/review-api.md`, `docs/invariants.md`, `fork/README.md`).
- ADR 0004 (review API v1 matches Lavish): field names and shapes stay; the retired `listener` and `page_open` frames are a minor per ADR 0008, which refines its rule on removals for server frames clients only read.
- ADR 0005 (one upstream annotate server per Review), ADR 0006 (the service answers the page decisions), ADR 0007 (annotate is a client of the service; doors serve only their Visibility): unchanged; annotate keeps its own session and Round handling.

## New Durable ADRs Created

- [`adr/0008-one-listener-holds-each-review.md`](../../../adr/0008-one-listener-holds-each-review.md): one holder per Review, hand-over on leave, retired frames as a minor version.
