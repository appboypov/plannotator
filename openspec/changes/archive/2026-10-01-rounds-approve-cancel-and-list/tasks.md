## 1. Records

- [x] 1.1 `records.ts`: Remarks and notices per Review, backlog, acknowledge
- [x] 1.2 `listen.ts`: replay notices, deliver new ones, ack

## 2. Rounds

- [x] 2.1 Approve and Close finish the Round with a Finish notice
- [x] 2.2 Cancel route
- [x] 2.3 Open: `user-ended`, `reopen`, next Round with a fresh page
- [x] 2.4 Round check: 400, 409 `ended`, 409 `stale-round`
- [x] 2.5 Page Round stream and the page closure

## 3. Docs and checks

- [x] 3.1 `docs/review-api.md`
- [x] 3.2 Tests: `listen.test.ts`, `page-round.test.ts`
