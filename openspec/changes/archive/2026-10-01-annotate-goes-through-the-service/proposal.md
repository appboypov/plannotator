## Why

Owning intent: `/Users/codaveto/Brainspace/intents/das/own-plannotator-at-gates/own-plannotator-at-gates.md`. Story: `/Users/codaveto/Brainspace/intents/das/own-plannotator-at-gates/epic-plannotator-service/discovery.md#7`.

`plannotator annotate` still starts its own one-shot server per call, so a gate has no lasting link, its feedback lives only in that process, and the approach's "two pages at once" needs every document to be a Review in the always-on service. The service now answers every route, so the CLI can become its client.

Pressure test:
- What if the service is not running? The call fails with a clear error naming `plannotator serve` and the port setting. A silent fallback to the one-shot server would hide a stopped service and split Review state, so there is none.
- What if two calls review different files? Each opens its own Review and listens with its own session id, so both wait at once; nothing is queued.
- What if the reviewer sends feedback? Upstream ended the call on Send feedback. The call takes the Remarks, cancels its Round so the page closes, and prints upstream's "annotated" markdown; the next call opens the next Round on the same link.
- What if the reviewer closes the page instead of approving? Approve without notes and Close both left a Finish with empty notes, so the CLI could not tell them apart. Close's Finish now carries `dismissed: true`, an additive field Lavish clients ignore.
- What if the reviewer sends question answers, images or code annotations? Remarks carry only annotations, so the page's whole feedback text would be lost. Each Remark now carries the page's text (`feedback`, additive), a send with text but no annotations is one Remark, and the call prints that text as upstream did.
- What if old Remarks or a pending notice of an earlier Round replay? The call takes only records of the Round it opened.
- What if the listen socket drops mid-Round? The call reconnects and the replay hands it the Round's records and its pending notice.
- What if the command exits before the service took its ack? It waits for the confirmation of an empty subscribe sent after the ack; the service takes a socket's frames in order.

## What Changes

- `plannotator annotate <file>` on a local file opens or reopens the file's Review in the running service (port `PLANNOTATOR_SERVICE_PORT`, else 4397), prints and opens its link, waits for the Round's end on the listen socket and prints upstream's outcome (`approved`, `dismissed`, `annotated`) with upstream's exit codes.
- No service: a clear error naming how to start it; exit 1, or 2 under a strict flag.
- URLs, folders, `--markdown`, live apps and `--tailscale` keep upstream's one-shot server.
- The service's Close Finish notice carries `dismissed: true`.
- A Remark carries the page's Send feedback text (`feedback`); a send with text but no annotations stores one `global_comment` Remark.
- `resolveServicePort` reads the shared port setting for clients of the service.

## Capabilities

### New Capabilities

- `annotate-command`: `plannotator annotate` on a local file is a client of the review service.

### Modified Capabilities

- `review-service`: a Close's Finish notice is marked `dismissed`; Remarks carry the page's feedback text.

## Impact

`apps/hook/server/annotate-service.ts` (new) and its call site in `apps/hook/server/index.ts`; `packages/server/review-service/{service.ts,records.ts,settings.ts,index.ts}`; `packages/shared/review-api/types.ts` (`FinishNotice.dismissed`); `docs/review-api.md`, `fork/README.md`; ADR 0007.
