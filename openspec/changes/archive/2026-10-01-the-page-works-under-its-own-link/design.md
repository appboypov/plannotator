## Context

Story 4 of `epic-plannotator-service`. Story 3 serves each Review's page at `/plannotator/session/<id>/` by forwarding to an upstream annotate server (ADR 0005). Upstream's plan page (`packages/editor/App.tsx`, `packages/ui`) calls `/api/...` at the site root in about 150 places: `fetch` (plan, feedback, approve, draft, doc, skills, config, upload ...), `EventSource` (external annotations, file watch, client lease, agent jobs), a `WebSocket` for the agent terminal, and `<img src="/api/image?...">` through `getImageSrc`.

## Goals / Non-Goals

**Goals:** every API call of the plan page served under a session path resolves under that path, on any origin (service, public door, temporary door).

**Non-Goals:** the code-review page; forwarding WebSockets; changing any upstream call site's URL.

## Decisions

- **Rebase at the browser boundary, not at each call.** `installReviewPageBase(window)` wraps `fetch` (string, `URL` and `Request` inputs), `EventSource` and `WebSocket` so a URL whose path starts with `/api/` on the page's own host goes to `<base>api/...`. Path-only URLs stay path-only, absolute ones keep their scheme. Rejected: editing every call site (dozens of upstream files, conflicts each release, ADR 0003); `<base href>` (absolute paths ignore it); the service guessing the Review from `Referer` (the page would still request root `/api/`, and a referrer policy can drop it).
- **The base comes from `location.pathname`.** `reviewPageBase` takes everything up to and including `/plannotator/session/<id>/`, so a door that keeps a prefix still works. No base is injected by the server: the forwarded HTML stays upstream's file.
- **Installed before anything calls.** `apps/hook/review-page-base.ts` is the entry's first import, so modules that fetch on load already see the wrapped globals. It also sets the image resolver to upstream's default followed by the rebase; upstream exports its default resolver for this.
- **Outside a session path nothing changes.** `installReviewPageBase` returns `null` and leaves the globals untouched, so `plannotator annotate` behaves as upstream.

## Risks / Trade-offs

- A future upstream transport outside these globals (for example `navigator.sendBeacon`) would call the root. Today the page has none; the smoke run's network log is the check.
