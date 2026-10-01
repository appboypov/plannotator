## Context

The service (stories 1.3 to 1.6 and Replies) answers every review API route. Upstream's `plannotator annotate` starts one annotate server per call and resolves on the page's decision. The approach (Part 2) drops the one-at-a-time queue: two pages at once, each document a Review.

## Decisions

- The CLI is a client of the review API, in its own module `apps/hook/server/annotate-service.ts` with one call site in `index.ts` (ADR 0003), placed after upstream's resolution, so path errors and strict exit codes stay upstream's.
- Only a plain local file goes through the service. URLs, folders, `--markdown`, live apps and `--tailscale` have no page in the service and keep upstream's one-shot server.
- No fallback when nothing answers on the port: the call fails with a message naming `plannotator serve` and `PLANNOTATOR_SERVICE_PORT`, through upstream's startup-failure exit (1, or 2 under a strict flag). See ADR 0007.
- The port setting is the one `serve` reads (`resolveServicePort` in `settings.ts`); 0 is refused because a client cannot find a free port the service picked.
- Open always sends `reopen: true`, so a call on an approved or cancelled Review starts its next Round, as a fresh upstream annotate did.
- One call is one Round. It listens with its own session id `plannotator-annotate-<pid>-<hex>`, subscribed to its Review only, and ignores records of another Review or Round, so open Remarks and pending notices of earlier Rounds replay harmlessly.
  - Remarks of its Round: the call collects them and cancels the Round once; the Cancel notice that follows ends the call as `annotated` with the page's feedback text of each send, once each; Remarks stored without that text are formatted like upstream's file export ("File Feedback").
  - Finish: `dismissed: true` gives `dismissed`; otherwise `approved` with the notes. Once Remarks of the Round arrived, any end gives `annotated`: as on upstream's page the first decision wins, so an Approve that beat the call's Cancel does not pass the gate.
  - A Cancel with no Remarks taken is another agent's: the call fails with `Round <n> of <link> was cancelled by another agent.`
  - It acks the notice it ends on, then sends an empty subscribe and exits after its `subscribed` confirmation (or 2 s), since an ack gets no answer and the service takes frames in order.
  - A dropped socket reconnects (30 tries, 1 s apart, starting over at each confirmed subscription) under a new session id `<session>-r<n>`: the service marks a Remark delivered when it sends it, so the same id would never replay a Remark lost with the old socket. The new session gets every open Remark of the Review; the call takes each once by id.
- A Remark carries the page's whole Send feedback text (`feedback`, Plannotator's addition), the same on every Remark of a send. Upstream's annotate printed that text, which holds question answers, images and code annotations that are not Remarks. A send with text but no annotations (such as the page's empty Done) is one `global_comment` Remark so it is not lost; a send with neither stores nothing. The text repeats per Remark in `remarks.json`, accepted for a simple record.
- The Close Finish gains `dismissed: true` rather than a new notice type: additive, `API_VERSION` stays 1.0, and Lavish clients read a Finish unchanged.
- The link prints to stderr and opens through upstream's `handleAnnotateServerReady` (browser, Glimpse, `PLANNOTATOR_SKIP_BROWSER_OPEN`), so stdout carries only the outcome.

## Risks

- A long Round holds a CLI process and one listen socket; the service's 30 s ping keeps it alive.
- Remarks the CLI turned into feedback stay open in the Review until a Reply answers them; the next call ignores them by Round.
