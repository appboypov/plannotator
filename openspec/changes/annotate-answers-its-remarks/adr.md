# ADR Review Manifest

- Status: completed
- Review date: 2026-10-02

## Review Summary

ADR review completed for this change.

## In-Force ADRs Reviewed

- ADR 0003 (fork-owned code and checks): every edit is in fork-owned files (`apps/hook/server/annotate-service.ts`, its test, `docs/`).
- ADR 0004 (review API v1 matches Lavish): unchanged; the call uses the existing Reply route.
- ADR 0007 (annotate is a client of the service): holds; annotate stays a client and answers through the public API.
- ADR 0008 (one listener holds each Review): the Reply makes the hand-over on leave skip what the call took.

## New Durable ADRs Created

None.
