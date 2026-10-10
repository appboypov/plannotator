# Design

## Subjects

A shared fork-owned subject module uses upstream parsePRUrl and formats its platform fields into a canonical URL. Open validates without network I/O. File subjects retain realpath resolution. Persisted subjects use the existing file field. Open finds a Review by its canonical subject. A file Review's id stays the SHA-256 of its path. A PR Review's id is 16 random hex characters made at first open: a PR URL is public, so a hashed id would let anyone work out a public or temporary link and Approve through the door.

## Pages and decisions

The serve starter branches on the stored subject. PR startup checks auth, fetches the current head and starts upstream startReviewServer with the embedded review HTML and no local checkout. ReviewPages retains its single-flight startup and retry behavior; reopening stops the page. A PR Round shows one head: a PR page remembers the head it fetched, the Round's first page writes it to `review.json` as `round_head`, and an open of its open Round fetches the PR again, with a page started on the current head when none runs after a restart; a moved head cancels that Round and starts the next, so the existing Round stream closes open tabs and the Round check refuses their Approve. The code review entry imports the fork page glue first. The service translates approved feedback to Finish and code annotations to Remarks, preserving draft clearing and Round refusals.

## Doors

The manifest allows only the read routes needed for the PR diff, context, file expansion and diff images plus existing Review commands. PR-only routes refuse file Reviews through a door. File expansion reads with the provider token, so a door passes it only for a `path` and `oldPath` of a file in the Round's patch: the PR page carries the patch it was started with, and the service checks it with upstream `findPatchFileEntry` before forwarding, as `api/review-image` already does. Diff responses lose local context, repo and git-user fields. Write routes outside Review state remain denied.

## CLI

The existing annotate service transport accepts a command identity and carries whether taken Remarks contain annotations. A thin review client uses upstream buildReviewOutput and handleReviewServerReady. Only a PR URL with optional --json uses this path. Other targets and mode flags keep upstream behavior.

## Verification

Fake page starters cover lifecycle and decision boundaries without GitHub. A dev service uses isolated state and free loopback ports with doors off. A real public PR proves session HTML, diff and listen-socket Remark and Finish delivery.
