## 1. Docs

- [x] 1.1 Root `README.md`: fork notice at the top pointing to `fork/README.md` and `docs/invariants.md`; verified by `git diff origin/main -- README.md` showing only added lines at the top
- [x] 1.2 `fork/README.md`: install and open a document, doors and ports, Visibility, review API, settings, launchd, development, rules, check, update
- [x] 1.3 `docs/invariants.md`: every port and who may connect, door rules, state, Rounds and the page, install and update

## 2. Verify

- [x] 2.1 Walk "Install and open a document" on this Mac against the live service: `plannotator annotate <scratch>.md` prints its link and the link shows the document in a browser; the review API open returns a link whose page and `api/plan` answer 200 with the document; both Reviews cancelled after. The install steps are walked when story 14 restores the service (`fork/dist/plannotator service install`)
- [x] 2.2 `lsof -iTCP -sTCP:LISTEN` of the LaunchAgent's process lists only ports `docs/invariants.md` names (4397, 4399, 4398, page servers on loopback)
