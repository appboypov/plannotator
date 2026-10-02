## Context

`apps/hook/server/annotate-service.ts` `waitForRound` collects the Round's `feedback_item`s, cancels the Round, and on the Cancel notice (`take`) acks it and calls `settle`, which sends `{ "type": "subscribe", "reviews": [] }` and resolves once `subscribed` comes back. The service's `ReviewListeners.reline` hands each Review whose holder changed to its new holder through `deliver`, which skips Remarks whose `status` is not `open`. `ReviewRecords.addReply` marks each Remark a Reply names `answered` in memory before the Reply route answers.

## Goals / Non-Goals

**Goals:**

- The Remarks an annotate call took are `answered` before the call leaves the line, so `reline` hands nothing over and `open_item_count` drops them.

**Non-Goals:**

- No new API surface; no change to the service.

## Decisions

- **One Reply from the client, awaited before the empty subscription.** `take` posts the Reply for the taken Remarks and calls `settle` when the Reply answers. The service has marked them answered before it answers the request, so the hand-over that the empty subscription (or the socket closing) triggers skips them. The alternative, the service answering a cancelled Round's Remarks, would change service behaviour for every agent's Cancel.
- **`ending` guard.** Once `take` has a result, later notices are only acked, so a replayed notice during the Reply cannot settle another outcome, and a socket that closes meanwhile does not reconnect or fail the call.
- **A failed Reply does not fail the gate.** The reviewer's feedback was taken; the call logs the failure and prints it.

## Risks / Trade-offs

- [The reviewer sees an agent Reply `Received by plannotator annotate.` under each Remark the call took] -> Accepted: no existing path answers a Remark without a Reply; it also confirms receipt.
- [A Reply that fails leaves the Remarks open, so the next holder still gets them] -> Logged; same as today's behaviour.
