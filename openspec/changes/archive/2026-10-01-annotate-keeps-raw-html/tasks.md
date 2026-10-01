## 1. Raw HTML stays on the one-shot server

- [x] 1.1 `annotatesThroughService` takes `rawHtml` and returns false for it; `index.ts` passes `!!rawHtml`.
- [x] 1.2 Tests: a local Markdown file goes through the service; a raw HTML target does not.
- [x] 1.3 Smoke: with no service on the port, `annotate page.html` starts the one-shot server and `annotate plan.md` names the missing service.
