# 3. Fork-owned code lives apart and checks run upstream's CI on Crabbox

Date: 2026-09-30

## Status

Accepted

## Context

`appboypov/plannotator` is a fork of `backnotprop/plannotator` that takes every upstream release and adds an always-on review service. Every fork edit to an upstream file is a possible merge conflict on the next release. The fork runs no GitHub Actions; its checks run on the VPS through Crabbox. Upstream tests read `.github/workflows/test.yml`.

## Decision

- Fork-owned files live under `fork/` or in new modules of their own; an upstream file gets only a small call site or pointer.
- Upstream files stay, including `.github/`. GitHub Actions stays off for the fork.
- The Crabbox `check` job runs the `run` steps of upstream's `test` job in `.github/workflows/test.yml`, read at run time by `fork/ci-check.ts`.
- `fork/README.md` is the fork guide: upstream updates, checks and fork rules.

## Consequences

- Upstream releases merge with few conflicts, and a new upstream check comes along with each release.
- A step that relies on a GitHub `uses:` action does not run on Crabbox; a check that needs it fails and shows it.
- The check depends on the shape of upstream's `test.yml`; if upstream renames the job, the check stops with a clear error.
