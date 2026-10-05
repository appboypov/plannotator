# ADR Review Manifest

- Status: completed
- Review date: 2026-10-05

## In-Force ADRs Reviewed

- ADR 0003 (fork-owned code and checks): the poster is a new fork-owned module; the other edits sit in fork-owned review-service and review-api files.
- ADR 0004 (review API v1 matches Lavish): the `issue` field, its refusals, the list field and the comment match the Lavish service's change of the same name; the addition raises the minor.
- ADR 0008 (one listener holds each Review): stays in force for Reviews without an issue; a linked Review has no line.
- ADR 0002, 0005, 0006 and both ADR 0007 files: unchanged.

## New Durable ADRs Created

- None in this repository. The shared way Lavish and Plannotator post reviewer events to their Multica issue is ADR-0010 in `/Users/codaveto/Repos/Plugins/omp-lavish-review/adr/0010-review-remarks-post-to-their-multica-issue.md`; this change builds the Plannotator service side of it.
