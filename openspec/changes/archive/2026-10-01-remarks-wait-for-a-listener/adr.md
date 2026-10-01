# ADR Review Manifest

- Status: completed
- Review date: 2026-10-01

## Review Summary

ADR review completed for this change. One new durable decision: the service answers the page's decisions (Send feedback now, Approve with story 1.6) instead of forwarding them to the page server.

## In-Force ADRs Reviewed

- `adr/0003-fork-owned-code-and-checks.md` (fork modules, no upstream file changed)
- `adr/0004-review-api-v1-matches-lavish.md` (listen socket and Remark shapes; delivery refined to once per session)
- `adr/0005-one-upstream-annotate-server-per-review.md` (the page server keeps everything else the page calls)

## New Durable ADRs Created

- `adr/0006-the-service-answers-the-page-decisions.md`
