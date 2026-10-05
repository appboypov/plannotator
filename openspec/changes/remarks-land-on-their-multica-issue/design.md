## Context

The fork's review service (`packages/server/review-service/`) keeps each Review in its own folder: `review.json` (the `StoredReview`, `store.ts`), `remarks.json` and `notices.json` (`records.ts`, durable records with ids, ADR 0004 parity with Lavish), and serves a versioned review API (`packages/shared/review-api/`) with one listener holding each Review (ADR 0008, `listen.ts`). ADR-0010 in `/Users/codaveto/Repos/Plugins/omp-lavish-review/adr/` sets the shared way Lavish and Plannotator post reviewer events to the Multica issue that links a Review; this change builds the Plannotator side of it in the service. The Lavish service's change of the same name in `~/Repos/Forks/pew-pew-lavish` is the reference build: same field names, comment shape and retry rule.

Multica facts this design rests on: `POST /api/issues/{id}/comments` with `Authorization: Bearer <mul_ token>` and `X-Workspace-ID` posts as the token's member and answers 201 with the comment's `id`; `{id}` is an issue key such as `WORK-167` or the issue id. A member's top-level comment starts the assignee agent's run whatever the issue status. Mentions are any `[..](mention://..)` link in the raw content, code blocks included. The CLI keeps a profile at `~/.multica/profiles/<name>/config.json` with `server_url`, `workspace_id` and `token`; the profile `skuddy` is Brian's member.

## Goals / Non-Goals

**Goals:**

- A Review stores the Multica issue it belongs to, given on the open call.
- Each Remark, Approve and Close of a linked Review becomes one comment on its issue within seconds, in store order, once, across failures and restarts.
- A linked Review's events reach no listener.

**Non-Goals:**

- No unlink, no change to `plannotator annotate`, Replies or Visibility, no Multica change.
- No page change: the Plannotator page shows no agent presence, so a linked Review needs no presence rule.

## Decisions

### The open call carries the link, the Review stores it

`issue: { id, workspace_id }` on `POST /api/review/v1/reviews` is parsed by `parseOpenReviewRequest` (`packages/shared/review-api/parse.ts`): both strings, trimmed, non-empty, or 400. The open handler in `service.ts` refuses an `issue` while `PLANNOTATOR_MULTICA_PROFILE` is unset with 400 before anything changes. `StoredReview` gains `issue: MulticaIssue | null`: an open without `issue` keeps the stored value, an open with one replaces it, like `visibility`. The open answer and `GET /api/review/v1/reviews` rows return `issue`. A `review.json` written before this change parses with `issue: null`.

Alternative: a separate link call. Rejected: the agent always knows its issue when it opens, and one call keeps the open atomic.

### Each record carries its own delivery state

`StoredRemark` and `StoredNotice` gain an optional `multica: { issue, workspace_id, status: "pending" | "posted", comment_id?, posted_at? }`, kept in `remarks.json` and `notices.json` beside the record (ADR 0004's durable records). When a Remark or an Approve or Close notice of a linked Review is stored, it gets `status: "pending"` with the Review's link in the same records write. A Cancel notice never gets one: an agent made it. The issue is copied onto the record, so a relink does not move records already posted.

An open with `issue` calls `records.relink(reviewId, issue)`: in one write it rewrites the destination of the Review's pending records, and enrolls the Review's open Remarks and pending Approve or Close notice that have no delivery state yet, so a Remark left before the first link reaches the issue. Answered Remarks, acknowledged notices and Cancels stay without one.

### One poster per service

A new fork-owned module, `packages/server/review-service/multica-poster.ts`, owns posting. It starts with the service, scans the records for pending deliveries, and is woken when records are stored and on a relink. Per Review it posts one record at a time in store order (the order `records.backlog` merges Remarks and notices), so comments appear in the order the reviewer made them; Reviews post independently. A failure (no profile, network error, timeout, non-2xx, an answer without `id`) leaves the record pending and schedules that Review's next attempt after a wait that doubles from one second to five minutes; a success resets it, and a relink retries at once. It reads the profile file at each attempt, so a new token needs no restart. A post sets `status: "posted"`, `comment_id` and `posted_at` and, for a notice, acknowledges it, in one records write. On stop it cancels its timers, aborts its requests and waits for its lanes.

Its log lines hold the Review id, the record id, the kind and the HTTP status only.

### The comment

Built by one pure function, tested on its own. A Remark:

```
**Remark** on [plan.md](<link>), round <n>:

> <remark text, every line quoted>

- Item: `fi_...`
- On: `<kind>` `<block id>`: "<excerpt on one line>"   (or "the whole page" when the anchor is empty)
- Review: `<review_id>`

Answer with `plannotator_reply` on Review `<review_id>` with answers [`fi_...`].
```

An Approve: `**Approved** round <n> of [plan.md](<link>).`, its notes quoted when it has any, then `- Notice:` with the `nt_` id and `- Review:` with the Review id. A Close: `**Closed** round <n> of [plan.md](<link>) without approving.` with the same list. The link text is the file's name, the link the Review's Link for its current Visibility. Every `mention://` in reviewer text, anchor and notes is written `mention:\/\/`: CommonMark renders `\/` as `/`, and Multica's mention pattern needs the contiguous `mention://`. Code spans pick a backtick fence longer than any backtick run in their value. A remark without words (a deletion) quotes nothing and keeps its anchor.

### Linked Reviews leave the listen line

`ReviewListeners` takes a predicate that says whether a Review is linked; `line(reviewId)` is empty for a linked Review. So neither the live path (`remarksStored`, `noticeStored`), a subscription's replay nor a hand-over sends its records, and `subscribers` (the list's `listeners`) is `[]`. The predicate reads the store, so a link takes effect on the next delivery.

Alternative: keep delivering to listeners as well. Rejected: the HQ chat session listens to all Reviews and would act on the same remark the issue's run acts on.

### The service names the profile

`PLANNOTATOR_MULTICA_PROFILE` is a service setting (`settings.ts`). The LaunchAgent plan (`apps/hook/server/launch-agent.ts`) sets `skuddy` and carries the installing shell's value over it, like the other settings. The plist holds the profile name only.

## Risks / Trade-offs

- [A wrong issue key or a workspace the member is not in fails every post] -> The record stays pending and the log names the Review, record and status each attempt; it holds only its own Review's later records. Opening the file again with the right `issue` rewrites the pending records' link and wakes the poster.
- [A post that succeeds but whose answer is lost is posted twice] -> Accepted: at-least-once; the comment holds the item id, so the agent sees the repeat.
- [A Public Review's remarks post as Brian] -> Accepted by ADR-0010: the comment says "Remark", not who made it.
- [`plannotator annotate` on a file whose Review is linked waits on the listen socket and hears nothing, because a linked Review reaches no listener] -> Accepted: linked Reviews are opened by Multica runs, and `annotate` is Brian's own gate for other files; its remarks still reach the issue.

## Migration Plan

Additive: Reviews without `issue` work as before. Install with `bun run setup` in `omp-plannotator-review` (or `plannotator service install`) after the merge, together with the plugin of the same change: the LaunchAgent picks up `PLANNOTATOR_MULTICA_PROFILE` on reinstall. Roll back by installing the previous build: stored `issue` and `multica` fields are ignored by it.

## Open Questions

None. ADR 0008 stays in force for Reviews without an issue; ADR-0010 narrows its scope without superseding it.
