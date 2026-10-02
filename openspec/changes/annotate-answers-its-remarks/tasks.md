## 1. Annotate answers what it took

- [x] 1.1 `apps/hook/server/annotate-service.test.ts` -- session on all plus an annotate call on `plan.md`; feedback settles the call; the session gets no `feedback_item` and `open_item_count` is 0 -- fails on `main` with a handed-over `feedback_item`
- [x] 1.2 `apps/hook/server/annotate-service.ts` -- `take` posts one Reply answering the taken Remarks, then settles; `ending` guard on later notices and on close -- 1.1 passes

## 2. Docs

- [x] 2.1 `docs/review-api.md` -- annotate section, Send feedback: the Reply and why
- [x] 2.2 `docs/invariants.md` -- annotate invariant: answers what it took before leaving

## 3. Verification

- [x] 3.1 `bun test apps/hook/server/annotate-service.test.ts` -- all pass
- [x] 3.2 Live smoke on a free port with a temporary data dir: `chat` on all, `plannotator annotate plan.md`, Send feedback; chat gets only `subscribed`, list shows `open_item_count: 0`, `listeners: ["chat"]` -- observed
- [x] 3.3 `openspec validate annotate-answers-its-remarks --type change --strict` -- valid

## Implementation Notes

Route oneshot: one function in one module (`waitForRound`, about 25 lines) plus its test and two doc paragraphs.

- No existing path answers a Remark silently: a Reply needs non-empty text (`parseReplyRequest`) and the page's sent-remarks panel shows it under each Remark it answers. The call's Reply reads `Received by plannotator annotate.`.
- The Reply is awaited before `settle` sends the empty subscription, and `addReply` marks the Remarks answered before the route answers, so `reline` skips them when the call leaves.
- 1.1 on the unchanged code: chat received `subscribed, feedback_item, subscribed`; with 1.2 it receives `subscribed, subscribed`.
- 3.2 smoke: `bun apps/hook/server/index.ts serve --port 4691` with `PLANNOTATOR_DATA_DIR` and `PLANNOTATOR_REVIEWS_DIR` under `/tmp/aair-smoke`, door ports unset, `apps/hook/dist` copied from the main checkout and removed after. Observed: listeners before feedback `["plannotator-annotate-18257-699b03fe202d","chat"]`; annotate printed `{"decision":"annotated","feedback":"Say who owns it."}`, exit 0; chat frames `["subscribed","subscribed"]`; list `{"open_item_count":0,"listeners":["chat"],"state":"cancelled"}`; page replies `[{"status":"answered","replies":["Received by plannotator annotate."]}]`.

## Plan Change Log

- 2026-10-02: planned and approved in the same run (Brian: "fix it").
