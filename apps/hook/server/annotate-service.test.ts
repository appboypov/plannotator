/**
 * `plannotator annotate <file>` through the real review service: each page decision
 * comes back as the outcome upstream's annotate settles (Approve, Close, Send feedback),
 * one call is one Round, two calls on two files wait at once, and a missing service
 * is an error that names how to start it.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OpenReviewResponse } from "@plannotator/shared/review-api";
import { startAnnotateServer } from "@plannotator/server/annotate";
import { startReviewService, type ReviewService } from "@plannotator/server/review-service";
import { annotateThroughService, type ServiceAnnotateResult } from "./annotate-service";

let dir: string;
let service: ReviewService | undefined;

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "plannotator-annotate-service-")));
});

afterEach(async () => {
  await service?.stop();
  service = undefined;
  rmSync(dir, { recursive: true, force: true });
});

async function start(): Promise<ReviewService> {
  service = await startReviewService({
    port: 0,
    reviewsDir: join(dir, "reviews"),
    version: "test",
    log: () => {},
    startPage: async (review) => {
      const page = await startAnnotateServer({
        markdown: readFileSync(review.file, "utf8"),
        filePath: review.file,
        htmlContent: "<html><body>Plannotator page</body></html>",
        gate: true,
      });
      return { port: page.port, stop: page.stop };
    },
  });
  return service;
}

function document(name: string): string {
  const file = join(dir, name);
  writeFileSync(file, `# ${name}\n\nFirst paragraph.\n`);
  return file;
}

/**
 * Starts an annotate call on [file]; [opened] resolves with its Review once the call
 * has opened it. The tests act on the page right away, before the call subscribes, so
 * what they check also proves the call takes its Round's records from the replay.
 */
function annotate(file: string): { result: Promise<ServiceAnnotateResult>; opened: Promise<OpenReviewResponse> } {
  let onOpened: (review: OpenReviewResponse) => void = () => {};
  const opened = new Promise<OpenReviewResponse>((resolve) => {
    onOpened = resolve;
  });
  const result = annotateThroughService({
    file,
    port: service!.port,
    onOpened: (review) => onOpened(review),
    reconnect: { attempts: 0, delayMs: 0 },
  });
  return { result, opened };
}

async function post(url: string, body?: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("plannotator annotate through the review service", () => {
  test("Approve with notes prints approved with the notes and acknowledges the Finish", async () => {
    await start();
    const file = document("plan.md");
    const call = annotate(file);
    const review = await call.opened;
    expect(review).toMatchObject({ status: "opened", round: 1 });

    expect((await post(`${review.link}api/approve`, { feedback: "Ship it.", annotations: [], round: 1 })).status).toBe(200);
    expect(await call.result).toEqual({ ok: true, outcome: { approved: true, feedback: "Ship it." } });

    // Acknowledged: a later listener is not handed this Finish again.
    await service!.stop();
    await start();
    const notices = JSON.parse(readFileSync(join(dir, "reviews", review.review_id, "notices.json"), "utf8"));
    expect(notices.notices.map((notice: { status: string }) => notice.status)).toEqual(["acknowledged"]);
  });

  test("Close prints dismissed", async () => {
    await start();
    const call = annotate(document("plan.md"));
    const review = await call.opened;
    expect((await post(`${review.link}api/exit?round=1`)).status).toBe(200);
    expect(await call.result).toEqual({ ok: true, outcome: { feedback: "", exit: true } });
  });

  test("Send feedback prints the page's feedback text as annotated, also for a send with no annotations", async () => {
    await start();
    // Question answers and code annotations reach the agent only through the page's text.
    const pageText = "# File Feedback\n\n## Answers\n\n**Which release?** The next one.\n";
    const call = annotate(document("plan.md"));
    const review = await call.opened;
    expect((await post(`${review.link}api/feedback`, { round: 1, feedback: pageText, annotations: [] })).status).toBe(200);
    expect(await call.result).toEqual({ ok: true, outcome: { feedback: pageText } });
  });

  test("Send feedback without the page's text prints its Remarks formatted, ends the Round, and the next call opens the next Round without it", async () => {
    await start();
    const file = document("plan.md");
    const first = annotate(file);
    const review = await first.opened;
    const sent = await post(`${review.link}api/feedback`, {
      round: 1,
      annotations: [
        { blockId: "block-1", type: "COMMENT", originalText: "First paragraph.", text: "Say who owns it." },
        { blockId: "block-0", type: "DELETION", originalText: "# plan.md", text: "" },
        { blockId: "", type: "GLOBAL_COMMENT", originalText: "", text: "Shorter, please." },
      ],
    });
    expect(sent.status).toBe(200);
    expect(await first.result).toEqual({
      ok: true,
      outcome: {
        feedback: [
          "# File Feedback",
          "",
          "I've reviewed this file and have 3 pieces of feedback:",
          "",
          '## 1. Feedback on: "First paragraph."',
          "> Say who owns it.",
          "",
          "## 2. Remove this",
          "```",
          "# plan.md",
          "```",
          "> I don't want this in the file.",
          "",
          "## 3. General feedback about the file",
          "> Shorter, please.",
          "",
          "---",
          "",
        ].join("\n"),
      },
    });
    // The page's Round ended, so a late Approve on it is refused.
    expect((await post(`${review.link}api/approve`, { round: 1 })).status).toBe(409);

    // The round-1 Remarks stay open, yet the next call waits for its own Round.
    const second = annotate(file);
    const next = await second.opened;
    expect(next).toMatchObject({ review_id: review.review_id, link: review.link, round: 2 });
    expect((await post(`${next.link}api/approve`, { round: 2 })).status).toBe(200);
    expect(await second.result).toEqual({ ok: true, outcome: { approved: true, feedback: "" } });
  });

  test("a Review the reviewer approved before reopens into the next Round", async () => {
    await start();
    const file = document("plan.md");
    const first = annotate(file);
    const review = await first.opened;
    await post(`${review.link}api/approve`, { round: 1 });
    await first.result;

    const second = annotate(file);
    expect(await second.opened).toMatchObject({ status: "opened", round: 2 });
    await post(`${review.link}api/exit?round=2`);
    expect(await second.result).toEqual({ ok: true, outcome: { feedback: "", exit: true } });
  });

  test("two calls on two files wait at the same time, each for its own page", async () => {
    await start();
    const plan = annotate(document("plan.md"));
    const brief = annotate(document("brief.md"));
    const [planReview, briefReview] = await Promise.all([plan.opened, brief.opened]);
    expect(planReview.review_id).not.toBe(briefReview.review_id);

    await post(`${briefReview.link}api/approve`, { feedback: "Brief is fine.", round: 1 });
    expect(await brief.result).toEqual({ ok: true, outcome: { approved: true, feedback: "Brief is fine." } });
    await post(`${planReview.link}api/exit?round=1`);
    expect(await plan.result).toEqual({ ok: true, outcome: { feedback: "", exit: true } });
  });

  test("another agent's Cancel is an error, not a reviewer outcome", async () => {
    const running = await start();
    const call = annotate(document("plan.md"));
    const review = await call.opened;
    await post(`${running.url}/api/review/v1/reviews/${review.review_id}/cancel`);
    const result = await call.result;
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toContain("cancelled by another agent");
  });

  test("no service on the port is an error that names how to start it", async () => {
    const probe = Bun.serve({ port: 0, fetch: () => new Response() });
    const freePort = probe.port;
    probe.stop(true);
    const result = await annotateThroughService({ file: document("plan.md"), port: freePort, onOpened: () => {} });
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toContain(`No Plannotator review service answers on http://127.0.0.1:${freePort}`);
    expect(result.ok ? "" : result.error).toContain("plannotator serve");
  });
});
