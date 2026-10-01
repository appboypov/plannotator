## Why

Owning intent: `/Users/codaveto/Brainspace/intents/das/own-plannotator-at-gates/own-plannotator-at-gates.md`. Story: `/Users/codaveto/Brainspace/intents/das/own-plannotator-at-gates/epic-plannotator-service/discovery.md#9`.

Story 8 stores an agent's Reply on a Remark and serves each Remark with its Replies at `<link>api/review-replies`, but the page shows none of it: after Send feedback the draft is cleared, so a reload shows an empty panel. A client reads the agent's answer only when the page shows it beside the Remark it answers (R5). Story 6 covers the page when its Round ends or a later Round opens; its stale-round client fix was proven by unit tests only, never in a rebuilt page.

Pressure test: what if one Reply answers two Remarks? It shows under each. What if a Reply answers none? It shows on its own after the Remarks. What if the replies call fails? The panel shows the draft as before and logs the failure; the review itself still works. Could a sent Remark be sent again? No: sent Remarks are not annotations of the draft, so Send feedback and Approve never carry them. What if a tab from Round 1 stays open after the agent reopens? Its Round stream reports round 2 and the page offers a reload; a command it still sends answers 409 `stale-round` and covers the page.

## What Changes

- The annotation panel lists the Remarks the reviewer sent, from every Round, read-only below the draft under a "Sent" divider, each stamped with its Round, with the agents' Replies indented under it and labelled "Reply".
- The panel loads them when it opens on a Review page; a plain `plannotator annotate` page is unchanged.
- The closed-page cover names the Round that ended or opened.

## Capabilities

### Modified Capabilities

- `review-service`: replies and Round state show on the page.

## Impact

`packages/shared/review-api/page-replies.ts` (new), `apps/hook/review-page-replies.ts` (new), `apps/hook/review-page-base.ts`, `apps/hook/review-page-closure.ts`, `packages/ui/components/SentRemarks.tsx` (new), `packages/ui/components/AnnotationPanel.tsx` (one call site and a `label` prop on the card), `packages/shared/package.json`.
