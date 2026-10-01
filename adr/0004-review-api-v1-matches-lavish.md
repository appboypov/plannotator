# 4. Review API v1 matches Lavish's wire contract

Date: 2026-10-01

## Status

Accepted

## Context

The fork's always-on review service exposes a review API and a listen socket to agents. Brian's Lavish fork (`appboypov/pew-pew-lavish`) already has one, with an omp plugin (`omp-lavish-review`) that speaks it. The Plannotator plugin (`omp-plannotator-review`) is copied from that plugin, and Plannotator's own words differ (Remark, Approve). Each plugin follows its own fork's API major, so the two update apart.

## Decision

- Review API v1 uses Lavish's review API v1 JSON field names and message types unchanged: `feedback_item` with `fi_` ids for a Remark, `finish` and `cancel` notices with `nt_` ids, `open_item_count` and `open_items`, `subscribe`, `ack`, `subscribed`, `listener`, `page_open`, `error`.
- Plannotator's differences are additive: a third Visibility `temporary`, `notes` on a `finish` (Approve) notice, the stored `reply` in a Reply answer, `minor` in the version answer.
- `GET /api/review/version` stays unversioned and answers `{ major, minor }`; routes live under `/api/review/v1/`; the page lives under `/plannotator/session/<review_id>/` and health at `/plannotator/health`.
- The contract's types live in the fork-owned module `packages/shared/review-api/` (`@plannotator/shared/review-api`); `docs/review-api.md` is its prose.

## Consequences

- A client written for Lavish's v1 reads this service without schema changes; only message element names in a plugin change.
- A renaming or removal of any field is a new major; a new field is a minor.
- Plannotator words appear in types and docs, Lavish words on the wire; the docs map one to the other.
