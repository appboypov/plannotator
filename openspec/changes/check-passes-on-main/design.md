## Decisions

- Pin the fix to behaviour, not to a Bun version. Crabbox (the fork's check) and this Mac run Bun 1.4.2; upstream's GitHub CI pins 1.3.14 and is off for the fork. The port tests pass on both by measuring the server's own `listening` count instead of assuming 0, which also matches Node, where the Pi server really runs.
- Pin `core.autocrlf=false` in the one temp repo whose premise (git diffs a missing index blob from the working tree) breaks under a checkout conversion, instead of isolating every temp repo from the global config.
- No change to `network.ts` or `review-core.ts`: both behave as intended; a blob git truly cannot read failing loudly is upstream's chosen behaviour (#1220).
