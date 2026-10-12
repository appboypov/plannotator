# One reviewer send is one delivery

## Why
A Send feedback stores one Remark per annotation, but posting each one separately wakes the Multica assignee once per annotation. Preserve individual answerable ids while delivering the send together.

## What changes
- Review API 1.4 adds optional `batch_id` to stored Remarks, listen frames and listed open items.
- Each Send feedback generates one `bt_` plus 24 lowercase hex identifier shared by its Remarks.
- Multica posts all still-pending Remarks of that batch as one comment, retaining the existing single-Remark format. Legacy Remarks and Approve/Close notices post alone.

## Scope
Plannotator service and shared API only; no plugin, Lavish or UI changes. Existing records are not backfilled. No PR is opened by this change.
