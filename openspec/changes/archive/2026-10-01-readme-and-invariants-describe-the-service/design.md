## Decisions

- One source per audience: `fork/README.md` for users and agents that install, open and update; `docs/invariants.md` for those changing the service; `docs/review-api.md` for clients. They point to each other and do not repeat each other's detail.
- The root `README.md` gets only a fork notice at its top, pointing to `fork/README.md`; upstream's text stays below it unchanged, so an upstream merge conflicts at most on those lines (ADR 0003).
