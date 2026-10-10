# 9. A pull request Review is one upstream review server behind the service

Date: 2026-10-05

## Status

Accepted

## Context

A PR Review has one lasting link, Round and listener contract. Upstream code review owns PR fetching, diff rendering and per-server draft state. ADR 0003 keeps fork behavior apart from upstream.

## Decision

- A canonical PR/MR URL is a Review subject in the existing file field. Open validates shape without fetching and finds the Review by its canonical subject. A PR Review's id is 16 random hex characters made at first open and kept in its state, not a hash of its URL: a PR URL is public, and the id is the secret part of its public or temporary link, so a hashed id would let anyone reach its door and Approve. File Reviews keep the hash of their path.
- The serve starter checks provider auth, fetches the PR and starts upstream startReviewServer on a free loopback port with the embedded review HTML and no checkout. The service keeps one page per Round and restarts it for the next Round. Failed startup is logged and retried.
- The service owns feedback and exit decisions. Code annotations become ordinary Remarks, Approve and Close become Finish notices. Draft clearing and Round checks match plan pages.
- The code review page installs the shared session-path and Round glue before rendering. Doors allow only review reads and Review state writes, stripping local paths and refusing external mutations.
- A plain PR review CLI invocation is a client of the shared Round transport. Other targets and mode flags use upstream one-shot review.

## Consequences

PR links and Remarks survive service restarts. Each Round reads the current PR head. Plugins consume unchanged listen messages. A PR page needs provider authentication on this Mac; a missing provider or PR fails the page request without discarding the Review.
