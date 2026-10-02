## 1. Fix

- [x] 1.1 Name `SentRemarks.test.tsx` in the UI DOM_TESTS step; verify `bun test scripts/dom-test-allowlist.test.ts` and `DOM_TESTS=1 bun test --isolate packages/ui/components/SentRemarks.test.tsx`
- [x] 1.2 Pin `core.autocrlf=false` in the missing-blob test's repo; verify it passes with a global `core.autocrlf=input`
- [x] 1.3 Baseline the server's own `listening` listeners in the 3 port-retry tests; verify on Bun 1.4.2 and 1.3.14, and that a leaked failed-attempt listener still fails them
- [x] 1.4 Full check passes: `crabbox job run check`, or `bun fork/ci-check.ts` while the Crabbox lease is held
