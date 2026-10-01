/**
 * Remarks, Rounds and the listen socket against the real service: Send feedback stores
 * one Remark per annotation, a listener that connects later receives them, a session
 * receives each Remark once (across reconnects and restarts), the socket's handshake
 * and frame rules; Approve, Close and Cancel end a Round with a notice, open starts the
 * next one, and a page command for a Round that is not open is refused.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ListenServerMessage, ListReviewsResponse, OpenReviewResponse } from "@plannotator/shared/review-api";
import { startAnnotateServer } from "../annotate";
import { startReviewService, type ReviewService } from "./service";

let dir: string;
let reviewsDir: string;
let service: ReviewService | undefined;
const sockets: WebSocket[] = [];
const saved: Record<string, string | undefined> = {};

async function start(): Promise<ReviewService> {
  service = await startReviewService({
    port: 0,
    reviewsDir,
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

async function openReview(name: string): Promise<OpenReviewResponse> {
  const file = join(dir, name);
  writeFileSync(file, `# ${name}\n\nFirst paragraph.\n`);
  return openFile(realpathSync(file));
}

async function openFile(file: string, extra: Record<string, unknown> = {}): Promise<OpenReviewResponse> {
  const answer = await fetch(`${service!.url}/api/review/v1/reviews`, {
    method: "POST",
    body: JSON.stringify({ file, ...extra }),
  });
  return (await answer.json()) as OpenReviewResponse;
}

async function post(url: string, body?: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** The first [count] events of a page's Round stream. */
async function roundEvents(link: string, count: number, during: () => Promise<unknown> = async () => {}): Promise<unknown[]> {
  const answer = await fetch(`${link}api/review-round`);
  expect(answer.headers.get("content-type")).toBe("text/event-stream");
  const reader = answer.body!.getReader();
  const events: unknown[] = [];
  let buffered = "";
  let acted = false;
  while (events.length < count) {
    const { value, done } = await reader.read();
    if (done) break;
    buffered += new TextDecoder().decode(value);
    for (let end = buffered.indexOf("\n\n"); end !== -1; end = buffered.indexOf("\n\n")) {
      const frame = buffered.slice(0, end);
      buffered = buffered.slice(end + 2);
      if (frame.startsWith("data: ")) events.push(JSON.parse(frame.slice(6)));
    }
    if (!acted) {
      acted = true;
      await during();
    }
  }
  await reader.cancel();
  return events;
}

/** The page's Send feedback, as upstream's plan page posts it. */
async function sendFeedback(link: string, annotations: Record<string, unknown>[]): Promise<Response> {
  return fetch(`${link}api/feedback`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ feedback: "# Annotations\n...", annotations, codeAnnotations: [], draftGeneration: 1 }),
  });
}

const COMMENT = { id: "a1", blockId: "block-2", type: "COMMENT", text: "Say why.", originalText: "First paragraph", startOffset: 0, endOffset: 15, createdA: 1 };
const DELETION = { id: "a2", blockId: "block-1", type: "DELETION", originalText: "First", startOffset: 0, endOffset: 5, createdA: 2 };

type Listener = {
  socket: WebSocket;
  messages: ListenServerMessage[];
  /** Resolves with the frames received from now until the next one of [type]. */
  until: (type: ListenServerMessage["type"]) => Promise<ListenServerMessage[]>;
  closed: Promise<number>;
};

async function listen(session: string): Promise<Listener> {
  const socket = new WebSocket(`${service!.url.replace("http", "ws")}/api/review/v1/listen?session=${session}`);
  sockets.push(socket);
  const messages: ListenServerMessage[] = [];
  const waiters: { type: string; from: number; resolve: (frames: ListenServerMessage[]) => void }[] = [];
  socket.addEventListener("message", (event) => {
    messages.push(JSON.parse(String(event.data)) as ListenServerMessage);
    for (const waiter of [...waiters]) {
      if (messages.at(-1)!.type !== waiter.type) continue;
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve(messages.slice(waiter.from));
    }
  });
  const closed = Promise.withResolvers<number>();
  socket.addEventListener("close", (event) => closed.resolve(event.code));
  const opened = Promise.withResolvers<unknown>();
  socket.addEventListener("open", opened.resolve);
  socket.addEventListener("error", opened.reject);
  await opened.promise;
  return {
    socket,
    messages,
    closed: closed.promise,
    until: (type) => {
      const frames = Promise.withResolvers<ListenServerMessage[]>();
      waiters.push({ type, from: messages.length, resolve: frames.resolve });
      return frames.promise;
    },
  };
}

async function subscribe(listener: Listener, reviews: "all" | string[]): Promise<ListenServerMessage[]> {
  const frames = listener.until("subscribed");
  listener.socket.send(JSON.stringify({ type: "subscribe", reviews }));
  return frames;
}

async function list(file?: string): Promise<ListReviewsResponse> {
  const query = file ? `?file=${encodeURIComponent(file)}` : "";
  return (await (await fetch(`${service!.url}/api/review/v1/reviews${query}`)).json()) as ListReviewsResponse;
}

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "pn-review-listen-")));
  reviewsDir = join(dir, "reviews");
  for (const key of ["PLANNOTATOR_PORT", "PLANNOTATOR_REMOTE", "PLANNOTATOR_DATA_DIR"]) saved[key] = process.env[key];
  delete process.env.PLANNOTATOR_PORT;
  process.env.PLANNOTATOR_REMOTE = "0";
  process.env.PLANNOTATOR_DATA_DIR = join(dir, "data");
});

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  await service?.stop();
  service = undefined;
  rmSync(dir, { recursive: true, force: true });
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("Remarks wait for a listener", () => {
  test("Send feedback stores one Remark per annotation; a later listener gets them once per session", async () => {
    await start();
    const review = await openReview("plan.md");
    const sent = await sendFeedback(review.link, [COMMENT, DELETION]);
    expect(sent.status).toBe(200);
    expect(await sent.json()).toEqual({ ok: true });

    const stored = JSON.parse(readFileSync(join(reviewsDir, review.review_id, "remarks.json"), "utf8")).remarks;
    expect(stored).toHaveLength(2);

    const first = await listen("session-a");
    const frames = await subscribe(first, [review.review_id]);
    expect(frames.map((frame) => frame.type)).toEqual(["feedback_item", "feedback_item", "subscribed"]);
    const [comment, deletion] = frames;
    expect(comment).toMatchObject({
      type: "feedback_item",
      review_id: review.review_id,
      round: 1,
      text: "Say why.",
      anchor: { selector: "block-2", tag: "comment", text: "First paragraph" },
    });
    expect(deletion).toMatchObject({ text: "", anchor: { selector: "block-1", tag: "deletion", text: "First" } });
    for (const frame of [comment, deletion]) expect("id" in frame && frame.id).toMatch(/^fi_[0-9a-f]{24}$/);

    first.socket.close();
    await first.closed;
    const again = await listen("session-a");
    expect((await subscribe(again, [review.review_id])).map((frame) => frame.type)).toEqual(["subscribed"]);

    const other = await listen("session-b");
    expect((await subscribe(other, "all")).filter((frame) => frame.type === "feedback_item")).toHaveLength(2);

    const listed = await list(join(dir, "plan.md"));
    expect(listed.reviews[0].open_item_count).toBe(2);
    expect(listed.reviews[0].open_items?.map((item) => item.id)).toEqual(stored.map((remark: { id: string }) => remark.id));
    expect(listed.reviews[0].listeners.sort()).toEqual(["session-a", "session-b"]);
  });

  test("a Remark sent while a session listens arrives live, and the delivery survives a restart", async () => {
    await start();
    const review = await openReview("plan.md");
    const listener = await listen("session-a");
    await subscribe(listener, "all");

    const live = listener.until("feedback_item");
    await sendFeedback(review.link, [COMMENT]);
    expect((await live).at(-1)).toMatchObject({ type: "feedback_item", text: "Say why." });

    listener.socket.close();
    await service!.stop();
    await start();
    const back = await listen("session-a");
    expect((await subscribe(back, "all")).map((frame) => frame.type)).toEqual(["subscribed"]);
    expect((await list()).reviews[0].open_item_count).toBe(1);
  });

  test("the reviewer can send again; empty feedback stores nothing; a sent draft is cleared", async () => {
    await start();
    const review = await openReview("plan.md");
    const saved = await fetch(`${review.link}api/draft`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ annotations: [COMMENT], draftGeneration: 1 }),
    });
    expect(saved.status).toBe(200);
    expect((await fetch(`${review.link}api/draft`)).status).toBe(200);
    expect((await sendFeedback(review.link, [COMMENT])).status).toBe(200);
    expect((await fetch(`${review.link}api/draft`)).status).toBe(404);

    expect((await sendFeedback(review.link, [])).status).toBe(200);
    expect((await list()).reviews[0].open_item_count).toBe(1);
    expect((await sendFeedback(review.link, [DELETION])).status).toBe(200);
    expect((await list()).reviews[0].open_item_count).toBe(2);
  });

  test("overlapping listeners hear of each other and of a page load", async () => {
    await start();
    const review = await openReview("plan.md");
    const a = await listen("session-a");
    await subscribe(a, [review.review_id]);
    const heard = a.until("listener");
    const b = await listen("session-b");
    const bFrames = await subscribe(b, "all");
    expect(bFrames).toContainEqual({ type: "listener", session: "session-a", reviews: [review.review_id] });
    expect((await heard).at(-1)).toEqual({ type: "listener", session: "session-b", reviews: [review.review_id] });

    const opened = a.until("page_open");
    expect((await fetch(review.link)).status).toBe(200);
    expect((await opened).at(-1)).toMatchObject({ type: "page_open", review_id: review.review_id, round: 1 });
  });

  test("a second socket of a session replaces the first", async () => {
    await start();
    const first = await listen("session-a");
    await listen("session-a");
    expect(await first.closed).toBe(1000);
  });

  test("refuses bad handshakes and frames", async () => {
    await start();
    const missing = await fetch(`${service!.url}/api/review/v1/listen`);
    expect(missing.status).toBe(400);
    expect(await missing.text()).toBe("session required\n");
    const foreign = await fetch(`${service!.url}/api/review/v1/listen?session=a`, { headers: { origin: "https://evil.example" } });
    expect(foreign.status).toBe(403);

    const listener = await listen("session-a");
    let error = listener.until("error");
    listener.socket.send("not json");
    expect((await error).at(-1)).toEqual({ type: "error", error: "expected a JSON subscribe or ack message" });
    error = listener.until("error");
    listener.socket.send(JSON.stringify({ type: "ack", id: "nt_000000000000000000000000" }));
    expect((await error).at(-1)).toEqual({ type: "error", error: "unknown notice nt_000000000000000000000000" });

    listener.socket.send(JSON.stringify({ type: "subscribe", reviews: ["x".repeat(70 * 1024)] }));
    expect(await listener.closed).toBe(1009);
  });
});

describe("Rounds, Approve, Cancel and list", () => {
  test("Approve with notes finishes the Round; listeners get the Finish until it is acknowledged", async () => {
    await start();
    const review = await openReview("plan.md");
    const live = await listen("session-a");
    await subscribe(live, [review.review_id]);

    await sendFeedback(review.link, [COMMENT]);
    const finish = live.until("finish");
    const approved = await post(`${review.link}api/approve`, { feedback: "Ship it, but name the owner.", annotations: [], draftGeneration: 2 });
    expect(approved.status).toBe(200);
    expect((await finish).at(-1)).toMatchObject({
      type: "finish",
      review_id: review.review_id,
      round: 1,
      notes: "Ship it, but name the owner.",
    });
    expect((await list()).reviews[0]).toMatchObject({ state: "finished", round: 1 });

    const later = await listen("session-b");
    const replay = await subscribe(later, "all");
    expect(replay.map((frame) => frame.type)).toEqual(["feedback_item", "finish", "listener", "subscribed"]);
    const noticeId = replay[1].type === "finish" ? replay[1].id : "";
    expect(noticeId).toMatch(/^nt_[0-9a-f]{24}$/);

    later.socket.send(JSON.stringify({ type: "ack", id: noticeId }));
    later.socket.send(JSON.stringify({ type: "ack", id: noticeId }));
    const third = await listen("session-c");
    expect((await subscribe(third, "all")).map((frame) => frame.type)).toEqual(["feedback_item", "listener", "listener", "subscribed"]);
    expect(later.messages.filter((frame) => frame.type === "error")).toEqual([]);
  });

  test("Approve without notes, and Close, finish with empty notes", async () => {
    await start();
    const first = await openReview("plan.md");
    const second = await openReview("brief.md");
    const listener = await listen("session-a");
    await subscribe(listener, "all");

    let finish = listener.until("finish");
    expect((await post(`${first.link}api/approve`, { draftGeneration: 1 })).status).toBe(200);
    expect((await finish).at(-1)).toMatchObject({ review_id: first.review_id, notes: "" });

    finish = listener.until("finish");
    expect((await post(`${second.link}api/exit?generation=1&round=1`)).status).toBe(200);
    expect((await finish).at(-1)).toMatchObject({ review_id: second.review_id, notes: "" });
  });

  test("a finished Review reopens only when asked, into the next Round on the same link with the current document", async () => {
    await start();
    const review = await openReview("plan.md");
    const file = join(dir, "plan.md");
    await post(`${review.link}api/approve`, { feedback: "", draftGeneration: 1 });

    const ended = await openFile(file);
    expect(ended).toEqual({ ...review, status: "user-ended", round: 1 });
    expect((await list()).reviews[0]).toMatchObject({ state: "finished", round: 1 });

    writeFileSync(file, "# plan.md\n\nRevised paragraph.\n");
    const reopened = await openFile(file, { reopen: true });
    expect(reopened).toEqual({ ...review, status: "opened", round: 2 });
    expect((await list()).reviews[0]).toMatchObject({ state: "open", round: 2 });

    expect(await (await fetch(review.link)).text()).toContain('<meta name="plannotator-review-round" content="2">');
    const plan = (await (await fetch(`${review.link}api/plan`)).json()) as { plan: string };
    expect(plan.plan).toBe("# plan.md\n\nRevised paragraph.\n");
  });

  test("Cancel ends the Round for the page and its listeners; an ended Review reports how it ended", async () => {
    await start();
    const review = await openReview("plan.md");
    const listener = await listen("session-a");
    await subscribe(listener, [review.review_id]);

    const cancelNotice = listener.until("cancel");
    const events = await roundEvents(review.link, 2, async () => {
      const cancelled = await post(`${service!.url}/api/review/v1/reviews/${review.review_id}/cancel`);
      expect(await cancelled.json()).toEqual({ review_id: review.review_id, state: "cancelled", round: 1 });
    });
    expect(events).toEqual([
      { review_id: review.review_id, round: 1, state: "open" },
      { review_id: review.review_id, round: 1, state: "cancelled" },
    ]);
    expect((await cancelNotice).at(-1)).toMatchObject({ type: "cancel", review_id: review.review_id, round: 1 });

    const refused = await sendFeedback(review.link, [COMMENT]);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({
      status: "ended",
      error: "round 1 has ended",
      round: 1,
      state: "cancelled",
      ended_by: "agent",
    });
    expect((await list()).reviews[0].open_item_count).toBe(0);

    const again = await post(`${service!.url}/api/review/v1/reviews/${review.review_id}/cancel`);
    expect(await again.json()).toEqual({ review_id: review.review_id, state: "cancelled", round: 1 });
    expect(listener.messages.filter((frame) => frame.type === "cancel")).toHaveLength(1);

    // A cancelled Review reopens without `reopen`.
    expect(await openFile(join(dir, "plan.md"))).toEqual({ ...review, status: "opened", round: 2 });

    const brief = await openReview("brief.md");
    await post(`${brief.link}api/approve`, { draftGeneration: 1 });
    const finished = await post(`${service!.url}/api/review/v1/reviews/${brief.review_id}/cancel`);
    expect(await finished.json()).toEqual({ review_id: brief.review_id, state: "finished", round: 1 });
    expect((await post(`${service!.url}/api/review/v1/reviews/ffffffffffffffff/cancel`)).status).toBe(404);
  });

  test("a page command for a Round that is not open writes nothing", async () => {
    await start();
    const review = await openReview("plan.md");
    await post(`${service!.url}/api/review/v1/reviews/${review.review_id}/cancel`);
    await openFile(join(dir, "plan.md"));

    const stale = await post(`${review.link}api/feedback`, { annotations: [COMMENT], round: 1 });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ status: "stale-round", error: "round 1 is not open; the Review is in round 2", round: 2 });
    expect((await post(`${review.link}api/approve`, { round: 0 })).status).toBe(400);
    expect((await post(`${review.link}api/exit?round=x`)).status).toBe(400);
    expect((await post(`${review.link}api/exit?round=1`)).status).toBe(409);
    expect((await list()).reviews[0]).toMatchObject({ state: "open", round: 2, open_item_count: 0 });

    expect((await post(`${review.link}api/feedback`, { annotations: [COMMENT], round: 2, draftGeneration: 3 })).status).toBe(200);
    expect((await list()).reviews[0].open_item_count).toBe(1);
  });

  test("Rounds and notices survive a restart", async () => {
    await start();
    const review = await openReview("plan.md");
    await post(`${review.link}api/approve`, { feedback: "Fine.", draftGeneration: 1 });
    await service!.stop();
    await start();

    expect((await list()).reviews[0]).toMatchObject({ state: "finished", round: 1 });
    const listener = await listen("session-a");
    const replay = await subscribe(listener, "all");
    expect(replay[0]).toMatchObject({ type: "finish", notes: "Fine." });
    expect(JSON.parse(readFileSync(join(reviewsDir, review.review_id, "notices.json"), "utf8")).notices[0]).toMatchObject({
      type: "finish",
      status: "pending",
    });
  });
});
