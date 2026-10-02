/// <reference types="bun-types" />
/** Guards feedback being handed to chat again after the real annotate CLI exits. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  HEALTH_PATH,
  LISTEN_PATH,
  REVIEWS_PATH,
  type ListReviewsResponse,
  type ListenServerMessage,
  type Review,
  type ReviewRepliesResponse,
} from "../../packages/shared/review-api";
import { closeServer, occupyConsecutivePorts } from "../helpers/ports";

const ROOT = resolve(import.meta.dir, "../..");
const CLI = join(ROOT, "apps/hook/server/index.ts");
const TIMEOUT_MS = 20_000;
const FEEDBACK = "# File Feedback\n\nName the owner and deadline.\n";
let dir: string;
let file: string;
let origin: string;
let env: Record<string, string | undefined>;
let chat: WebSocket | undefined;
let frames: ListenServerMessage[];
const children: ReturnType<typeof spawn>[] = [];

function spawn(args: string[]) {
  const process = Bun.spawn([Bun.which("bun")!, CLI, ...args], {
    cwd: dir, env, stdin: "ignore", stdout: "pipe", stderr: "pipe",
  });
  return {
    process,
    stdout: new Response(process.stdout).text(),
    stderr: new Response(process.stderr).text(),
  };
}

async function within<T>(promise: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out waiting for ${what}`)), TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}

async function until<T>(read: () => Promise<T | undefined>, what: string): Promise<T> {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== undefined) return value;
    await Bun.sleep(25); // Poll observable readiness, not elapsed time.
  }
  throw new Error(`Timed out waiting for ${what}`);
}

async function json<T>(url: string): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  const body = await response.text();
  if (!response.ok) throw new Error(`GET ${url}: HTTP ${response.status} ${body}`);
  return JSON.parse(body) as T;
}

async function reviewOf(): Promise<Review | undefined> {
  const list = await json<ListReviewsResponse>(`${origin}${REVIEWS_PATH}?file=${encodeURIComponent(file)}`);
  return list.reviews[0];
}

async function subscribeAll(): Promise<void> {
  await within(new Promise<void>((resolve, reject) => {
    const subscribed = (event: MessageEvent) => {
      const frame = JSON.parse(String(event.data)) as ListenServerMessage;
      if (frame.type !== "subscribed") return;
      chat!.removeEventListener("message", subscribed);
      expect(frame).toEqual({ type: "subscribed", reviews: "all" });
      resolve();
    };
    chat!.addEventListener("message", subscribed);
    chat!.addEventListener("error", () => reject(new Error("chat subscription failed")), { once: true });
    chat!.send(JSON.stringify({ type: "subscribe", reviews: "all" }));
  }), "chat's all subscription");
}

beforeEach(async () => {
  dir = realpathSync(mkdtempSync("/tmp/plannotator-annotate-answers-"));
  file = join(dir, "plan.md");
  writeFileSync(file, "# Plan\n\nName the owner and deadline.\n");
  mkdirSync(join(dir, "home"));
  env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("PLANNOTATOR_")) delete env[key];
  delete env.TYPESAFE_API_KEY;
  Object.assign(env, {
    HOME: join(dir, "home"),
    PLANNOTATOR_DATA_DIR: join(dir, "data"),
    PLANNOTATOR_REVIEWS_DIR: join(dir, "reviews"),
    PLANNOTATOR_REMOTE: "0",
    PLANNOTATOR_SKIP_BROWSER_OPEN: "1",
    PLANNOTATOR_GLIMPSE: "0",
    PLANNOTATOR_AI: "disabled",
    PLANNOTATOR_SHARE: "disabled",
    PLANNOTATOR_PUBLIC_PORT: "off",
    PLANNOTATOR_TEMPORARY_PORT: "off",
  });
  const { start: port, servers } = await occupyConsecutivePorts(1);
  await Promise.all(servers.map(closeServer));
  expect(port).not.toBe(4397);
  env.PLANNOTATOR_SERVICE_PORT = String(port);
  origin = `http://127.0.0.1:${port}`;
  const service = spawn(["serve", "--port", String(port)]);
  children.push(service);
  await until(async () => {
    if (service.process.exitCode !== null) throw new Error(`serve exited ${service.process.exitCode}: ${await service.stderr}`);
    return await fetch(`${origin}${HEALTH_PATH}`)
      .then(async (response) => response.ok && (await response.json()).ok ? true : undefined)
      .catch(() => undefined);
  }, "isolated serve process");

  frames = [];
  chat = new WebSocket(`${origin.replace("http", "ws")}${LISTEN_PATH}?session=chat`);
  chat.addEventListener("message", (event) => frames.push(JSON.parse(String(event.data)) as ListenServerMessage));
  await within(new Promise<void>((resolve, reject) => {
    chat!.addEventListener("open", () => resolve(), { once: true });
    chat!.addEventListener("error", () => reject(new Error("chat connection failed")), { once: true });
  }), "chat connection");
  await subscribeAll();
});

afterEach(async () => {
  chat?.close();
  chat = undefined;
  for (const child of children) if (child.process.exitCode === null) child.process.kill();
  await Promise.all(children.splice(0).map((child) => child.process.exited));
  rmSync(dir, { recursive: true, force: true });
});

async function annotate(round = 1) {
  const child = spawn(["annotate", file, "--json"]);
  children.push(child);
  const review = await until(async () => {
    if (child.process.exitCode !== null) throw new Error(`annotate exited ${child.process.exitCode}: ${await child.stderr}`);
    const review = await reviewOf();
    return review?.state === "open" && review.round === round &&
      review.listeners.some((listener) => listener.startsWith("plannotator-annotate-")) ? review : undefined;
  }, `annotate's named subscription to round ${round}`);
  return { child, review };
}

async function pageCommand(review: Review, command: "feedback" | "approve", annotations: Record<string, unknown>[]) {
  const response = await fetch(`${review.link}api/${command}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ feedback: command === "feedback" ? FEEDBACK : "", annotations, codeAnnotations: [], round: review.round }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
}

function annotation(id: string, text: string) {
  return { id, blockId: "block-2", type: "COMMENT", text, originalText: "Name the owner and deadline." };
}

async function settled(child: ReturnType<typeof spawn>, review: Review) {
  expect(await within(child.process.exited, "annotate exit")).toBe(0);
  expect(await child.stderr).toContain(review.link);
  expect(JSON.parse(await child.stdout)).toEqual({ decision: "annotated", feedback: FEEDBACK });
  const listed = await until(async () => {
    const review = await reviewOf();
    return review?.listeners.every((listener) => listener === "chat") ? review : undefined;
  }, "annotate to leave the Review's line");
  expect(listed).toMatchObject({ state: "cancelled", round: 1, open_item_count: 0, listeners: ["chat"] });
  // Re-subscribe is an ordered socket barrier and asks for any remaining backlog.
  await subscribeAll();
  expect(frames.filter((frame) => frame.type === "feedback_item")).toEqual([]);
  return await json<ReviewRepliesResponse>(`${review.link}api/review-replies`);
}

describe("plannotator annotate goes through the review service", () => {
  test("Send feedback", async () => {
    const { child, review } = await annotate();
    expect(review.round).toBe(1);
    await pageCommand(review, "feedback", [annotation("owner", "Name the owner."), annotation("deadline", "Name the deadline.")]);
    const sent = await settled(child, review);
    expect(sent.remarks.map((remark) => remark.text)).toEqual(["Name the owner.", "Name the deadline."]);
    expect(sent.replies).toEqual([]);
    const ids = sent.remarks.map((remark) => remark.id);
    for (const remark of sent.remarks) {
      expect(remark).toMatchObject({ round: 1, status: "answered" });
      expect(remark.replies).toHaveLength(1);
      // This is the explicit receipt required by this change, not incidental UI copy.
      expect(remark.replies[0]).toMatchObject({ text: "Received by plannotator annotate.", answers: ids });
    }
    expect(new Set(sent.remarks.flatMap((remark) => remark.replies.map((reply) => reply.id))).size).toBe(1);

    const next = await annotate(2);
    expect(next.review.link).toBe(review.link);
    expect(next.review.review_id).toBe(review.review_id);
    expect(next.review.round).toBe(2);
    await pageCommand(next.review, "approve", []);
    expect(await within(next.child.process.exited, "next annotate exit")).toBe(0);
    expect(JSON.parse(await next.child.stdout)).toEqual({ decision: "approved" });
  }, 60_000);

  test("A session on all is not handed the Remarks a call took", async () => {
    const { child, review } = await annotate();
    expect(review.round).toBe(1);
    await pageCommand(review, "feedback", [annotation("owner", "Name the owner.")]);
    const sent = await settled(child, review);
    expect(sent.remarks).toHaveLength(1);
    const remark = sent.remarks[0];
    expect(remark).toMatchObject({ round: 1, text: "Name the owner.", status: "answered" });
    expect(remark.replies).toHaveLength(1);
    expect(remark.replies[0]).toMatchObject({ text: "Received by plannotator annotate.", answers: [remark.id] });
    expect(sent.replies).toEqual([]);
  }, 60_000);
});
