## 1. Page base

- [x] 1.1 `packages/shared/review-api/page-base.ts`: `reviewPageBase`, `rebaseApiUrl`, `installReviewPageBase`; export `./review-api/page-base`; verified by `bun test packages/shared/review-api/page-base.test.ts`
- [x] 1.2 `apps/hook/review-page-base.ts` installs it first in `apps/hook/index.tsx` and routes image sources through it; upstream's `defaultImageSrcResolver` exported; verified by `tsc --noEmit -p packages/shared/tsconfig.json` and `-p packages/ui/tsconfig.json`

## 2. Verification

- [x] 2.1 Smoke: `bun run build:review && bun run build:hook`, `plannotator serve --port 4497`, open a Review, load its link in a browser: the document renders, a comment annotation is added and its draft saved, and the network log has no request to root `/api/`
- [x] 2.2 `openspec validate the-page-works-under-its-own-link --type change --strict` passes
