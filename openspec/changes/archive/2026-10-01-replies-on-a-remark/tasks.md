## 1. Replies

- [x] 1.1 `records.ts`: `replies.json`, `unknownRemarks`, `addReply` (marks Remarks answered), `page`; verified by `listen.test.ts` "Replies on a Remark"
- [x] 1.2 `service.ts`: `POST .../replies` and `GET <link>api/review-replies`; verified by `listen.test.ts`
- [x] 1.3 Contract: `PageRemark`, `ReviewRepliesResponse`, `RemarkStatus`, `PAGE_REPLIES_PATH`; verified by `bun run typecheck`

## 2. Docs and cleanup

- [x] 2.1 `docs/review-api.md`: page Replies route, `replies.json`, every route built
- [x] 2.2 Delete `packages/server/review-api/stub.ts` and its docs section
- [x] 2.3 Smoke: reply through the API on a dev service, restart it, the page route still shows the Reply under the Remark
