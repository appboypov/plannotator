## Decisions

- Pin the fix to behaviour, not to a Bun version. Crabbox (the fork's check) and this Mac run Bun 1.4.2; upstream's GitHub CI pins 1.3.14 and is off for the fork. The port tests pass on both by comparing the `listening` listeners with the server's own, taken after `createServer()`, instead of assuming none, which also matches Node, where the Pi server really runs. Comparing the listeners themselves, not their count, also catches a retry that drops one of the server's own while leaking one of its own.
- Pin `core.autocrlf=false` in the one temp repo whose premise (git diffs a missing index blob from the working tree) breaks under a checkout conversion, instead of isolating every temp repo from the global config.
- No change to `network.ts` or `review-core.ts`: both behave as intended; a blob git truly cannot read failing loudly is upstream's chosen behaviour (#1220).
