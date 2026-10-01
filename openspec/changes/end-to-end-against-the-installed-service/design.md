## Decisions

- The suite drives the page's commands over HTTP with the body the page sends (`api/feedback`, `api/approve` with the `round` from the page's `plannotator-review-round` meta tag) instead of a headless browser: the service answers those commands itself (ADR 0006), so this is the path a click takes after `page-round.ts`, without a browser dependency.
- The public door is checked through `https://ctas.de-appspecialist.nl/plannotator/session/<id>/`, the way a visitor reaches it, with a 200 control after making the Review public so a 404 from a broken route cannot pass.
- It lives in `fork/e2e/` and is named `*.e2e.ts`, outside `bun test`'s globs (ADR 0003: fork code apart; upstream's check stays upstream's).
