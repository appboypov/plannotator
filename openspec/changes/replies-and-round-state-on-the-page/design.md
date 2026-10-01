## Context

Story 8 serves a Review's Remarks with their Replies at `<link>api/review-replies` (`ReviewRepliesResponse`: every Remark of all Rounds in store order, each with `replies`, plus `replies` that answer no Remark). Story 6 added the Round stream, the pinned Round `<meta>` and the closed-page cover (`apps/hook/review-page-closure.ts`).

## Decisions

- **Sent Remarks are not draft annotations.** They show in their own read-only section of the annotation panel, below the draft, under a "Sent" divider that matches the panel's "Code" and "Editor" dividers. They never join `annotations`, so no export, Send feedback, Approve, share link or draft carries them again.
- **The panel's own card.** Each Remark renders with upstream's `AnnotationCard`, read-only, with a `Round N` stamp in the card's header slot. Each Reply renders as the same card, labelled `Reply`, author `Agent`, indented under the Remark like upstream's `inReplyTo` threads. A Reply answering several Remarks shows under each; Replies answering none follow last on their own. The only change to the card is an optional `label` that replaces the type word.
- **Seam like the image resolver.** `packages/ui/components/SentRemarks.tsx` owns the section and a module-level source (`setSentRemarksSource`), as `ImageThumbnail` owns `setImageSrcResolver`. `apps/hook/review-page-base.ts` installs the source on a Review page only, so `App.tsx` is untouched and every other page renders as before. The panel calls `<SentRemarks>` once.
- **Load when the panel opens.** The section loads when it mounts, so a reload, or reopening the panel, shows Replies that arrived since. A failed load logs and shows no section; the draft and the review still work.
- **Reading and mapping.** `packages/shared/review-api/page-replies.ts` reads the route under the page's base path and keeps well-formed records only. `apps/hook/review-page-replies.ts` maps them to panel cards (`tag` to annotation type, `anchor.text` to the excerpt).
- **Round state.** The cover names the Round: `Round N is finished`, `Round N was cancelled`, `Round N is open` with a reload. The approving tab keeps upstream's own completion screen (story 6); a reload of a finished Round shows the finished cover.

## Risks

Sent Remarks carry no text offsets, so they are not highlighted in the document; the excerpt in the card shows where each one sits.
