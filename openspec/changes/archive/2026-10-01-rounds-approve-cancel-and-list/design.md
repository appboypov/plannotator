## Context

Story 5 made the service answer the page's Send feedback (ADR 0006) because upstream's decision settles once per server. Approve and Close are the same kind of decision.

## Decisions

- **Approve and Close are answered by the service.** Approve finishes the Round with `notes = feedback` (`""` without notes). Close finishes it with empty notes, as upstream's gate lets a dismissed review pass. The approve annotations are not Remarks.
- **One records store.** `records.ts` (`ReviewRecords`) keeps Remarks (`remarks.json`) and notices (`notices.json`) per Review, with one write chain per file; `backlog` merges open Remarks and pending notices by time.
- **Round check like Lavish.** An ended current Round refuses any command with 409 `ended` (`ended_by` `user` for finished, `agent` for cancelled); else a `round` other than the current answers 409 `stale-round`. `round` is optional, so upstream callers without it still work; the page sends it. The check runs again after the draft is cleared, so a racing end wins.
- **Ending order.** The state and the notice are recorded in memory at once, written, then published to the page stream and the listeners.
- **Reopen.** Finished without `reopen` answers `user-ended` and writes nothing. Cancelled, or finished with `reopen`, starts round + 1 with a new `round_opened_at`, stops that Review's page server (`ReviewPages.stop`) so the next request serves the document as it is now, and publishes the Round.
- **Closing the page.** The service serves `<link>api/review-round` (an event stream of `Round`). The page's HTML carries the Round it was loaded in (`<meta name="plannotator-review-round">`, added by the service), so a reconnecting stream cannot move it; the page module (`page-round.ts`) reads it, adds `round` to its commands, and covers the page (`review-page-closure.ts`) when someone else ends the Round, a later Round opens, or a command answers 409. The page's own Approve or Close keeps upstream's own completion screen.
- **Store writes serialize per Review** so an older `review.json` never lands over a newer one.

## Risks

Upstream's page `stop` also closes the process's file-browser watchers; open pages' streams reconnect. Accepted: Reviews of single files do not use the file browser.
