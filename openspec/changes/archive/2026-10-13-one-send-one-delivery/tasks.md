# Tasks

- [x] Add failing targeted tests for batch identity, wire propagation and grouped Multica posts (initial run: 56 passed, six expected failures).
- [x] Implement API 1.4 optional batch identity and durable batched posting.
- [x] Update API docs, fork README, invariants and capability specifications.
- [x] Run named targeted test files (100 passed); run repository typecheck (fails outside this change in review-editor: 40 diagnostics across 14 untouched files). Commit and push the branch without a PR.

Verifier fixes: restored the renamed delta requirement, identified `batch_id` as a fork addition, simplified the comment builder's batch contract, and added `batch=` to both poster outcomes. The poster test file passed (10 pass, 0 fail, 72 expectations); strict change validation and all-artifact validation passed (7 pass, 0 fail).

Runtime smoke used the real review/annotate servers with isolated data and a local HTTP comment sink: three answers formed one complete comment, a refused POST retried the identical batch, and pending/posted logs carried the same batch id and HTTP statuses without remark text or file paths.
