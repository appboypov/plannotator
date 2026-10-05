## Why

A Remark, Approve or Close on a Plannotator Review reaches an agent only when an omp session listens to the Review. The agents now run as Multica tasks: a run ends when its turn ends, so no session of the issue's agent is there to listen. Today the HQ chat session listens to all Reviews, finds the issue that names each Review and copies every remark into it by hand. Brian wants every remark, Approve and Close on a Review to show up by itself as a comment on the Multica issue that links the Review, within seconds, holding the remark text, the item id and the place in the file, and starting the run of the issue's agent. No omp session listens or copies.

Owning intent: `/Users/codaveto/Repos/Ventures/madspec/intents/persona-agents-in-multica/persona-agents-in-multica.md` (Brian's 5 October request in WORK-165, the Plannotator sibling of WORK-164).

Success signal: a Review opened with a Multica issue gets a Remark on the page; within seconds the issue has a comment by Brian's member with the remark text, its `fi_` id and its anchor, and the issue's agent starts a run. An Approve and a Close do the same with their Round and `nt_` id.

## What Changes

- The open call (`POST /api/review/v1/reviews`) takes an optional `issue`: the Multica issue (a key such as `WORK-167`, or its id) and its workspace id. The Review stores it: opening again without `issue` keeps it, with an `issue` replaces it.
- The open answer and the Review list carry each Review's `issue`, or null.
- The service posts each Remark, each Approve and each Close of a linked Review as a top-level comment on its issue, as the member whose Multica CLI profile `PLANNOTATOR_MULTICA_PROFILE` names. An agent's Cancel is not posted.
- Each posted record keeps a durable delivery state beside it in the Review's folder. A failed post retries with backoff, and a started service posts what is still pending, in store order.
- A linked Review's Remarks and notices go to its issue only: no listener receives them, and its `listeners` in the list is empty.
- The open call with `issue` is refused when `PLANNOTATOR_MULTICA_PROFILE` is not set.
- The LaunchAgent sets `PLANNOTATOR_MULTICA_PROFILE` to `skuddy`.
- The review API version becomes 1.3 (1.2 is the pull request Reviews change, built beside this one).
- `docs/review-api.md`, `docs/invariants.md` and `fork/README.md` describe the link, the comment and the setting.

## Capabilities

### New Capabilities

- `multica-delivery`: a Review linked to a Multica issue posts each Remark, Approve and Close as a comment on it, durably and in order, and its records reach no listener.

### Modified Capabilities

- `review-api`: the open call takes `issue`, the list returns it, and the version is 1.3.
- `review-service`: the LaunchAgent names the Multica CLI profile the service posts as.

## Impact

`packages/shared/review-api/` (types, parse, version), `packages/server/review-service/` (stored link, delivery state, a new poster module, listener exclusion, wiring), `apps/hook/server/launch-agent.ts` (service environment), `packages/server/review-service/settings.ts` (setting), tests, `docs/review-api.md`, `docs/invariants.md`, `fork/README.md`. Clients: `omp-plannotator-review` gives `plannotator_open` the issue in its change of the same name. The Multica server API (`POST /api/issues/{id}/comments`) is used as it is.

## Constraints

- ADR 0004 (review API v1 matches Lavish) and ADR 0008 (one listener holds each Review) hold for Reviews without an issue. ADR-0010 in `omp-lavish-review` records the shared way for Lavish and Plannotator; this change builds the Plannotator service side of it.
- Review event logs hold only ids, counts, kinds and status codes: never remark text, file paths or tokens.
- No token is written to the review folder, a plist or a log.

## Non-goals

- No unlink call: a Review keeps its issue until it is opened with another.
- No change to `plannotator annotate`, to Replies or to Visibility.
- No Multica-side change.
- The `feedback` text of a Send feedback (question answers, images, code annotations) is not part of the comment.

## Assumptions

- Brian's member posts the comment, so the issue's agent starts a run: Multica starts the assignee's run on a member's top-level comment, and not on an agent's comment without a mention.
- The CLI profile `skuddy` on this Mac is Brian's member token, which is a member of every client workspace.

## Sources

- Multica issues WORK-167 (this build) and WORK-165 (its story), written by Fallon on 2026-10-05, and the ADR-0010 notes on WORK-165.
- `/Users/codaveto/Repos/Plugins/omp-lavish-review/adr/0010-review-remarks-post-to-their-multica-issue.md`.
- The Lavish service's change of the same name in `~/Repos/Forks/pew-pew-lavish`, the reference build.
