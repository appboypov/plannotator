# 7. plannotator annotate is a client of the service

Date: 2026-10-01

## Status

Accepted

## Context

Upstream's `plannotator annotate` starts its own annotate server per call and waits for that page's decision. The fork's service (ADR 0005, 0006) keeps one lasting Review per document with Rounds, Remarks and notices, and the approach wants two pages at once with no one-at-a-time queue. Keeping both paths for local files would split a document's state between a one-shot server and its Review.

## Decision

- `plannotator annotate` on a local file opens or reopens the file's Review in the running service and waits for the Round's end on the listen socket with its own session id (`apps/hook/server/annotate-service.ts`). One call is one Round: Send feedback makes the call cancel the Round and print the Remarks.
- It reads the service's port setting (`PLANNOTATOR_SERVICE_PORT`, else 4397).
- When nothing answers, the call fails with a message naming `plannotator serve`; it never falls back to the one-shot server.
- URLs, folders, `--markdown`, live apps and `--tailscale` keep upstream's one-shot server: the service has no page for them.
- A Close's Finish notice carries `dismissed: true` so a client tells Close from an Approve without notes.

## Consequences

- Annotate calls on different files run at once and every gate has a lasting link.
- `plannotator annotate` on a local file needs the service running (launchd, story 1.12).
- Upstream changes to annotate's local-file path need a check against this module; its output shapes and exit codes are reused from upstream (`completeAnnotateCommand`).
