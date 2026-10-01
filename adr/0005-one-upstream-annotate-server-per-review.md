# 5. One upstream annotate server per Review, behind the service

Date: 2026-10-01

## Status

Accepted

## Context

The fork's review service (`plannotator serve`) serves many documents at once from one port, each Review's page under `/plannotator/session/<review_id>/`. Upstream's page server, `startAnnotateServer` in `packages/server/annotate.ts`, serves one document per server and keeps all session state in one closure: decision, client lease, drafts, version history, agent terminal. ADR 0003 keeps fork code out of upstream files so releases merge cleanly.

## Decision

- Each Review's page is upstream's own annotate server with the plan page, started for that Review's document on a free loopback port the first time the page is requested, and kept while the service runs.
- The service forwards `/plannotator/session/<review_id>/<rest>` to `/<rest>` on that Review's server and streams the answer back. The service owns the review API, health and the Review registry; the page server owns everything the page calls.
- Upstream's server files are not changed to serve several documents; per-Review state stays in each server's closure.

## Consequences

- Every upstream page feature and fix arrives with a release merge, with no per-Review state to port.
- The service holds one loopback port and one set of upstream resources per loaded page; ending or restarting a page (for a new Round) is a matter of stopping its server.
- Whatever a page server takes from the process (working directory, environment, process-wide watchers) is shared by all pages; the service fixes those for its process.
- The page must call its API relative to its own path (story 4) for the forwarding to reach it.
