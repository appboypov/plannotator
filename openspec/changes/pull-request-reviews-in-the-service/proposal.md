# Why

Brian reviews each pull request through one lasting Review whose line comments reach the existing listen socket and whose approval is the merge pass.

# What Changes

- Review subjects include canonical PR/MR URLs with API version 1.2.
- Each PR Review serves upstream code review behind the service, with Round-aware page glue and restricted doors.
- Code annotations become Remarks; Approve and Close become Finish notices.
- `plannotator review <PR_URL>` uses the service without a checkout or fallback.

# Impact

The review API, page orchestration, door manifest, review app entry and CLI client share the existing Review lifecycle. Plugins and live service installation stay outside this change.
