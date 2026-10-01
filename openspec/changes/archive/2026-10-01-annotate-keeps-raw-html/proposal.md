## Why

`plannotator annotate` sent a local `.html` file, and a file with `--render-html`, to the review service (change annotate-goes-through-the-service). The service page shows Markdown only, so the raw HTML view was lost. Found by the local review after that change merged.

## What Changes

- Raw HTML targets keep upstream's one-shot server, like URLs, folders, live apps, `--markdown` and `--tailscale`.
- The routing rule in `apps/hook/server/annotate-service.ts` (`annotatesThroughService`) takes `rawHtml`; its call site in `index.ts` passes it.

## Capabilities

### Modified Capabilities

- `annotate-command`: raw HTML targets stay on upstream's one-shot server.

## Impact

`apps/hook/server/annotate-service.ts`, `apps/hook/server/index.ts` (one argument), `apps/hook/server/annotate-service.test.ts`.
