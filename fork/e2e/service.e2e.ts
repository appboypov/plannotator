/**
 * End-to-end scenarios against the INSTALLED review service: the LaunchAgent
 * `nl.de-appspecialist.plannotator` on 127.0.0.1:4397, the binary at `~/.local/bin/plannotator`
 * and the public door behind https://ctas.de-appspecialist.nl/plannotator/.
 *
 *   bun test ./fork/e2e/service.e2e.ts
 *
 * Not part of `bun test`: the file name matches none of its globs, so the suite runs only when
 * named. It never skips: when the service is stopped or another server answers, every scenario
 * fails. Each scenario writes its documents into its own scratch folder and cancels its Reviews
 * afterwards; the cancelled Reviews stay in the service's list, as every Review does.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  HEALTH_PATH,
  LISTEN_PATH,
  PUBLIC_ORIGIN,
  REVIEWS_PATH,
  SERVICE_PORT,
  cancelPath,
  reviewPagePath,
  visibilityPath,
  type HealthResponse,
  type ListReviewsResponse,
  type ListenServerMessage,
  type OpenReviewResponse,
  type Review,
  type ReviewId,
  type Visibility,
} from "../../packages/shared/review-api/index.ts";
import { PAGE_ROUND_META } from "../../packages/shared/review-api/page-round.ts";

const SERVICE = `http://127.0.0.1:${SERVICE_PORT}`;
const LISTEN = `ws://127.0.0.1:${SERVICE_PORT}${LISTEN_PATH}`;
const LABEL = "nl.de-appspecialist.plannotator";
const BINARY = join(homedir(), ".local/bin/plannotator");
const SCENARIO_MS = 60_000;

// --- Scratch documents and their Reviews, cleaned after each scenario ---

const scratchDirs: string[] = [];
const opened = new Set<ReviewId>();

afterEach(async () => {
  for (const reviewId of opened) {
    // A scenario that failed because the service is down cannot cancel; its own failure says why.
    await fetch(`${SERVICE}${cancelPath(reviewId)}`, { method: "POST" }).catch(() => undefined);
  }
  opened.clear();
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Writes [text] into a new scratch Markdown file and answers its canonical path. */
function scratchDocument(name: string, text: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "plannotator-e2e-")));
  scratchDirs.push(dir);
  const file = join(dir, name);
  writeFileSync(file, text);
  return file;
}

// --- The review API, as a client calls it ---

async function json<T>(response: Response, what: string): Promise<T> {
  const body = await response.text();
  if (!response.ok) throw new Error(`${what}: HTTP ${response.status} ${body}`);
  return JSON.parse(body) as T;
}

async function open(file: string, visibility?: Visibility): Promise<OpenReviewResponse> {
  const response = await fetch(`${SERVICE}${REVIEWS_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file, ...(visibility ? { visibility } : {}) }),
  });
  const review = await json<OpenReviewResponse>(response, `open ${file}`);
  opened.add(review.review_id);
  return review;
}

async function reviewOf(file: string): Promise<Review | undefined> {
  const list = await json<ListReviewsResponse>(await fetch(`${SERVICE}${REVIEWS_PATH}?file=${encodeURIComponent(file)}`), "list");
  return list.reviews[0];
}

async function setVisibility(reviewId: ReviewId, visibility: Visibility): Promise<void> {
  await json(
    await fetch(`${SERVICE}${visibilityPath(reviewId)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ visibility }),
    }),
    `visibility ${visibility}`,
  );
}

/** Loads a Review page the way a browser does and answers the Round it pins in its HTML. */
async function loadPage(link: string): Promise<number> {
  const response = await fetch(link);
  const html = await response.text();
  expect(response.status).toBe(200);
  const round = new RegExp(`<meta name="${PAGE_ROUND_META}" content="(\\d+)"`).exec(html)?.[1];
  expect(round).toBeDefined();
  return Number(round);
}

/** Posts one of the page's Round-checked commands, with the body the page sends. */
async function pageCommand(link: string, command: "feedback" | "approve", body: Record<string, unknown>): Promise<void> {
  const response = await fetch(`${link}api/${command}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(await json<{ ok: boolean }>(response, `page ${command}`)).toEqual({ ok: true });
}

/** Connects a listener under a fresh session, subscribes to [reviewId] and answers every frame up to `subscribed`. */
async function listenOnce(reviewId: ReviewId): Promise<ListenServerMessage[]> {
  const socket = new WebSocket(`${LISTEN}?session=plannotator-e2e-${randomBytes(6).toString("hex")}`);
  const frames: ListenServerMessage[] = [];
  try {
    return await new Promise<ListenServerMessage[]>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no subscribed frame for ${reviewId}`)), 10_000);
      socket.onopen = () => socket.send(JSON.stringify({ type: "subscribe", reviews: [reviewId] }));
      socket.onerror = () => reject(new Error(`listen socket failed on ${LISTEN}`));
      socket.onmessage = (event) => {
        const frame = JSON.parse(String(event.data)) as ListenServerMessage;
        frames.push(frame);
        if (frame.type === "subscribed") {
          clearTimeout(timer);
          resolve(frames);
        }
      };
    });
  } finally {
    socket.close();
  }
}

async function until<T>(read: () => Promise<T | undefined>, what: string, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== undefined) return value;
    await Bun.sleep(200);
  }
  throw new Error(`timed out waiting for ${what}`);
}

describe("the installed review service", () => {
  test(
    "answers as the LaunchAgent with the installed binary's version",
    async () => {
      const health = await json<HealthResponse>(await fetch(`${SERVICE}${HEALTH_PATH}`), "health");
      const installed = Bun.spawnSync([BINARY, "--version"]);
      expect(installed.exitCode).toBe(0);
      expect(health.ok).toBe(true);
      expect(health.service?.label).toBe(LABEL);
      expect(installed.stdout.toString().trim()).toBe(`plannotator ${health.version}`);
    },
    SCENARIO_MS,
  );

  test(
    "keeps two documents open at once, each on its own page",
    async () => {
      const first = scratchDocument("first.md", "# First document\n\nThe first of two.\n");
      const second = scratchDocument("second.md", "# Second document\n\nThe second of two.\n");
      const [a, b] = await Promise.all([open(first), open(second)]);

      expect(a.review_id).not.toBe(b.review_id);
      expect([a.status, b.status]).toEqual(["opened", "opened"]);
      expect([a.link, b.link]).toEqual([`${SERVICE}${reviewPagePath(a.review_id)}`, `${SERVICE}${reviewPagePath(b.review_id)}`]);
      expect([(await reviewOf(first))?.state, (await reviewOf(second))?.state]).toEqual(["open", "open"]);

      const plans = await Promise.all(
        [a, b].map(async (review) => {
          await loadPage(review.link);
          return (await json<{ plan: string }>(await fetch(`${review.link}api/plan`), "api/plan")).plan;
        }),
      );
      expect(plans).toEqual(["# First document\n\nThe first of two.\n", "# Second document\n\nThe second of two.\n"]);
    },
    SCENARIO_MS,
  );

  test(
    "hands a Remark sent while no one listens to a later listener",
    async () => {
      const file = scratchDocument("late.md", "# Late remark\n\nA paragraph to remark on.\n");
      const review = await open(file);
      const round = await loadPage(review.link);
      expect((await reviewOf(file))?.listeners).toEqual([]);

      await pageCommand(review.link, "feedback", {
        feedback: "Tighten this paragraph.",
        annotations: [{ blockId: "block-1", type: "COMMENT", originalText: "A paragraph to remark on.", text: "Tighten this paragraph." }],
        codeAnnotations: [],
        round,
      });
      expect((await reviewOf(file))?.open_item_count).toBe(1);

      const frames = await listenOnce(review.review_id);
      const remarks = frames.filter((frame) => frame.type === "feedback_item");
      expect(remarks).toHaveLength(1);
      expect(remarks[0]).toMatchObject({
        type: "feedback_item",
        review_id: review.review_id,
        round,
        text: "Tighten this paragraph.",
        anchor: { selector: "block-1", tag: "comment", text: "A paragraph to remark on." },
      });
      expect(frames.at(-1)).toEqual({ type: "subscribed", reviews: [review.review_id] });
    },
    SCENARIO_MS,
  );

  test(
    "returns approved from plannotator annotate --gate --json when the page approves",
    async () => {
      const file = scratchDocument("gate.md", "# Gate\n\nApprove me.\n");
      const env: Record<string, string | undefined> = { ...process.env, PLANNOTATOR_SKIP_BROWSER_OPEN: "1" };
      delete env.PLANNOTATOR_SERVICE_PORT;
      const annotate = Bun.spawn([BINARY, "annotate", file, "--gate", "--json"], { env, stdout: "pipe", stderr: "pipe" });
      try {
        const review = await until(async () => {
          if (annotate.exitCode !== null) throw new Error(`annotate exited ${annotate.exitCode}: ${await new Response(annotate.stderr).text()}`);
          const found = await reviewOf(file);
          return found?.state === "open" ? found : undefined;
        }, "annotate to open its Review");
        opened.add(review.review_id);

        const round = await loadPage(review.link);
        await pageCommand(review.link, "approve", { feedback: "", annotations: [], codeAnnotations: [], round });

        const exitCode = await Promise.race([annotate.exited, Bun.sleep(20_000).then(() => "timeout" as const)]);
        // A child that never exits keeps its streams open; stop it so they can be read.
        if (exitCode === "timeout") annotate.kill();
        const stderr = await new Response(annotate.stderr).text();
        if (exitCode === "timeout") throw new Error(`annotate did not exit within 20 s of the Approve; stderr:\n${stderr}`);
        expect(exitCode).toBe(0);
        expect(stderr).toContain(review.link);
        expect(JSON.parse(await new Response(annotate.stdout).text())).toEqual({ decision: "approved" });
        expect((await reviewOf(file))?.state).toBe("finished");
      } finally {
        annotate.kill();
      }
    },
    SCENARIO_MS,
  );

  test(
    "refuses a local Review through the public door, and serves it once public",
    async () => {
      const file = scratchDocument("door.md", "# Door\n\nLocal until made public.\n");
      const review = await open(file);
      const publicPage = `${PUBLIC_ORIGIN}${reviewPagePath(review.review_id)}`;
      expect(review.visibility).toBe("local");

      expect((await fetch(publicPage)).status).toBe(404);

      // The same link answers once the Review is public, so the 404 above is the door's refusal.
      await setVisibility(review.review_id, "public");
      expect((await fetch(publicPage)).status).toBe(200);

      await setVisibility(review.review_id, "local");
      expect((await fetch(publicPage)).status).toBe(404);
    },
    SCENARIO_MS,
  );
});
