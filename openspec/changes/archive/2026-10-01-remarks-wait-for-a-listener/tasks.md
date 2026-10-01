## 1. Remarks

- [x] 1.1 `packages/server/review-service/remarks.ts`: `remarksFromFeedback`, `remarkEvent`, `openRemark`, `RemarkStore` (load, add, delivered, open, atomic writes to `remarks.json`); verified by `bun test packages/server/review-service/listen.test.ts`
- [x] 1.2 `service.ts` answers `POST <link>api/feedback`: stores, sends, clears the draft, answers `{ ok: true }`; the list reports `open_item_count`, `listeners`, `open_items`

## 2. Listen socket

- [x] 2.1 `packages/server/review-service/listen.ts`: `ReviewListeners` (handshake data, one socket per session, subscribe replay, `listener` and `page_open` events, error frames, 1009, heartbeat); `service.ts` upgrades `/api/review/v1/listen`
- [x] 2.2 Tests in `packages/server/review-service/listen.test.ts`: two annotations become two Remarks a later listener gets once; live delivery survives a restart; repeated sends and draft clearing; overlapping listeners and page loads; replacement; bad handshakes and frames

## 3. Contract and docs

- [x] 3.1 `docs/review-api.md`: once-per-session delivery, `remarks.json`, Send feedback, what is built
- [x] 3.2 `adr/0006-the-service-answers-the-page-decisions.md`

## 4. Verification

- [x] 4.1 Smoke: `bun run build:review && bun run build:hook`, `plannotator serve --port 4497`, open a Review, add two annotations in the browser and Send feedback, then connect a listener: two `feedback_item` frames with `fi_` ids; reconnect the same session: none
- [x] 4.2 `openspec validate remarks-wait-for-a-listener --type change --strict` passes
