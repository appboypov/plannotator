# 6. The service answers the page's decisions

Date: 2026-10-01

## Status

Accepted

## Context

ADR 0005 puts each Review's page on its own upstream annotate server behind the service. Upstream's page server takes the reviewer's decisions (`api/feedback`, `api/approve`) through one `decision.settle` per server: the first settles it and every later one is refused as `alreadyDecided`. Its decision holds the formatted feedback text, not one record per annotation. The review API (ADR 0004) needs each annotation as a Remark with its own id, sent feedback more than once per Round, and Approve as a Finish notice that listeners receive.

## Decision

- The service answers the page's decision routes under `/plannotator/session/<review_id>/` itself, from upstream's request bodies: `api/feedback` now (story 1.5), `api/approve` with Rounds (story 1.6). It stores the result in the Review's folder and sends it to listeners.
- The page server never receives these routes, so its decision stays open while the service runs. The service performs the side effects the page expects from those routes on the page server, such as clearing the sent draft through `DELETE api/draft`.
- Every other page call is still forwarded (ADR 0005).

## Consequences

- Upstream's page works unchanged and the reviewer can send feedback many times in a Round.
- Upstream changes to these routes' bodies or side effects need a matching change in the service; `docs/review-api.md` names the fields it reads.
- The page server's own decision outcome (its `waitForDecision`) is unused by the service.
