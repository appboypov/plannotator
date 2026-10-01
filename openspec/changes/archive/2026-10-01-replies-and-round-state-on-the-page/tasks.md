## 1. Replies on the page

- [x] 1.1 `page-replies.ts`: read `<base>api/review-replies`, keep well-formed records (`page-replies.test.ts`)
- [x] 1.2 `review-page-replies.ts`: Remarks and Replies as panel cards (`review-page-replies.test.ts`)
- [x] 1.3 `SentRemarks.tsx` and its call site in `AnnotationPanel.tsx`; card `label` (`SentRemarks.test.tsx`, `DOM_TESTS=1`)
- [x] 1.4 `review-page-base.ts` installs the source on Review pages

## 2. Round state

- [x] 2.1 The cover names the Round
- [x] 2.2 Rebuilt page: a finished Round's reload shows the finished cover; a stale tab after reopen gets 409 `stale-round`, the next-round cover, and stores nothing (browser smoke)

## 3. Proof

- [x] 3.1 Browser: reply via the API, reload, the Reply shows under the Remark; a sent Remark is not sent again
- [x] 3.2 `bun run typecheck`
