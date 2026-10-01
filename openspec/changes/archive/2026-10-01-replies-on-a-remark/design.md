## Context

Story 5 stores Remarks per Review in `records.ts` with a `status` that already allows `answered`, and the backlog replays only open Remarks. Story 9 draws Replies on the page; it needs one page route under the session path (so `page-base` rebases it) that answers on open and ended Rounds.

## Decisions

- **Replies live in `records.ts`.** `ReviewRecords` keeps a third file per Review, `replies.json` (`{ "replies": [Reply] }`), on the same per-file write chain. `addReply` appends the Reply and marks named Remarks `answered` in memory first, then writes `replies.json`, then `remarks.json`. The two files cannot be committed together, so load repairs a stop between them: a stored Reply marks the Remarks it names `answered`.
- **Validation before writing.** `parseReplyRequest` (contract) checks `text` and `answers`; `unknownRemarks` checks every id against all the Review's Remarks of every Round. Any unknown id answers 400 `UnknownRemarksResponse` and nothing is written.
- **No review.json write.** A Reply never saves the Review's metadata, so the metadata-save rule (read `store.get` after the last await) is not involved.
- **Page route answered by the service.** `GET <link>api/review-replies` is answered like the Round stream: not forwarded to the upstream page server. It returns every Remark (without `delivered_to`, which is listener data) with `replies` naming it, plus `replies` naming none. It answers on any Round state.
- **No listen event for a Reply**, as in Lavish.
- **Stub deleted.** The service answers every route now, so the stub and its docs section go, as `docs/review-api.md` promised.
