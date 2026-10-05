/**
 * Remarks, Rounds and the listen socket against the real service: Send feedback stores
 * one Remark per annotation, a listener that connects later receives them, a session
 * receives each Remark once (across reconnects and restarts), the socket's handshake
 * and frame rules; one listener holds each Review and the next in line takes it over
 * with what it has not received; Approve, Close and Cancel end a Round with a notice,
 * open starts the next one, and a page command for a Round that is not open is refused.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ListenServerMessage,
  ListReviewsResponse,
  OpenReviewResponse,
  ReplyResponse,
  ReviewRepliesResponse,
} from "@plannotator/shared/review-api";
import { startAnnotateServer } from "../annotate";
import { startReviewService, type ReviewService } from "./service";

let dir: string;
let reviewsDir: string;
let service: ReviewService | undefined;
const sockets: WebSocket[] = [];
const saved: Record<string, string | undefined> = {};

async function start(options: { heartbeatMs?: number } = {}): Promise<ReviewService> {
  service = await startReviewService({
    port: 0,
    reviewsDir,
    version: "test",
    heartbeatMs: options.heartbeatMs,
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

/**
 * The types of the frames [listener] received from index [from] on, read once the
 * service answered a probe sent after them, so a frame it sent before is counted.
 */
async function typesFrom(listener: Listener, from: number): Promise<string[]> {
  const probe = listener.until("error");
  listener.socket.send(JSON.stringify({ type: "ack", id: "nt_000000000000000000000000" }));
  await probe;
  return listener.messages.slice(from, -1).map((frame) => frame.type);
}

/**
 * Waits until the list shows [sessions] as [reviewId]'s line: the line change and its
 * hand-over happened. A socket's close reaches the service with no signal a client can
 * await, so this polls the list, the service's only view of the line.
 */
async function lineIs(reviewId: string, sessions: string[]): Promise<void> {
  for (let tries = 0; tries < 300; tries += 1) {
    const listed = (await list()).reviews.find((review) => review.review_id === reviewId);
    if (JSON.stringify(listed?.listeners) === JSON.stringify(sessions)) return;
    await Bun.sleep(10);
  }
  throw new Error(`the line of ${reviewId} never became [${sessions.join(", ")}]`);
}

/**
 * A listener for [session] subscribed to [reviews] that never answers a ping: a raw
 * WebSocket client, since Bun's client answers pings on its own. Returns its end.
 */
async function silentListener(session: string, reviews: string[]): Promise<() => void> {
  const { hostname, port } = new URL(service!.url);
  const upgraded = Promise.withResolvers<void>();
  const socket = await Bun.connect({
    hostname,
    port: Number(port),
    socket: {
      data: (_socket, chunk) => {
        if (chunk.toString("latin1").startsWith("HTTP/1.1 101")) upgraded.resolve();
      },
    },
  });
  socket.write(
    `GET /api/review/v1/listen?session=${session} HTTP/1.1\r\nHost: ${hostname}:${port}\r\nUpgrade: websocket\r\n` +
      "Connection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n",
  );
  await upgraded.promise;
  const payload = Buffer.from(JSON.stringify({ type: "subscribe", reviews }));
  const mask = [1, 2, 3, 4];
  // One masked text frame; the payload stays under 126 bytes, so its length fits the second byte.
  socket.write(Buffer.from([0x81, 0x80 | payload.length, ...mask, ...payload.map((byte, index) => byte ^ mask[index % 4])]));
  return () => socket.end();
}

async function reply(reviewId: string, answers: string[]): Promise<Response> {
  return post(`${service!.url}/api/review/v1/reviews/${reviewId}/replies`, { text: "Done.", answers });
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

    // A session subscribed to all stands behind one that names the Review, and takes it
    // with its open Remarks once that one leaves.
    const other = await listen("session-b");
    expect((await subscribe(other, "all")).map((frame) => frame.type)).toEqual(["subscribed"]);

    const listed = await list(join(dir, "plan.md"));
    expect(listed.reviews[0].open_item_count).toBe(2);
    expect(listed.reviews[0].open_items?.map((item) => item.id)).toEqual(stored.map((remark: { id: string }) => remark.id));
    expect(listed.reviews[0].listeners).toEqual(["session-a", "session-b"]);

    const from = other.messages.length;
    const handedOver = other.until("feedback_item");
    again.socket.close();
    await handedOver;
    expect(await typesFrom(other, from)).toEqual(["feedback_item", "feedback_item"]);
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

  test("the reviewer can send again; empty feedback stores nothing; text alone is one Remark; a sent draft is cleared", async () => {
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

    const empty = await fetch(`${review.link}api/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feedback: "", annotations: [], codeAnnotations: [], draftGeneration: 1 }),
    });
    expect(empty.status).toBe(200);
    expect((await list()).reviews[0].open_item_count).toBe(1);
    expect((await sendFeedback(review.link, [DELETION])).status).toBe(200);
    expect((await list()).reviews[0].open_item_count).toBe(2);

    // Only the page's text (question answers, code annotations): one Remark carries it.
    expect((await sendFeedback(review.link, [])).status).toBe(200);
    const items = (await list(join(dir, "plan.md"))).reviews[0].open_items;
    expect(items).toHaveLength(3);
    expect(items[2]).toMatchObject({ text: "# Annotations\n...", feedback: "# Annotations\n...", anchor: { selector: "", tag: "global_comment", text: "" } });
    expect(items[1]).toMatchObject({ anchor: { tag: "deletion" }, feedback: "# Annotations\n..." });
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

describe("One listener holds each Review", () => {
  test("a listener that names the Review comes before one subscribed to all, also for an Approve", async () => {
    await start();
    const review = await openReview("plan.md");
    const chat = await listen("chat");
    await subscribe(chat, "all");
    const from = chat.messages.length;
    const agent = await listen("agent");
    await subscribe(agent, [review.review_id]);

    const remark = agent.until("feedback_item");
    await sendFeedback(review.link, [COMMENT]);
    expect((await remark).at(-1)).toMatchObject({ type: "feedback_item", text: "Say why." });
    const finish = agent.until("finish");
    expect((await post(`${review.link}api/approve`, { feedback: "Ship it.", draftGeneration: 2 })).status).toBe(200);
    expect((await finish).at(-1)).toMatchObject({ type: "finish", notes: "Ship it." });
    expect(await typesFrom(chat, from)).toEqual([]);
    expect((await list()).reviews[0].listeners).toEqual(["agent", "chat"]);
  });

  test("the first listener that names a Review holds it", async () => {
    await start();
    const review = await openReview("plan.md");
    const s1 = await listen("s1");
    await subscribe(s1, [review.review_id]);
    const s2 = await listen("s2");
    await subscribe(s2, [review.review_id]);
    const from = s2.messages.length;

    const remark = s1.until("feedback_item");
    await sendFeedback(review.link, [COMMENT]);
    await remark;
    expect(await typesFrom(s2, from)).toEqual([]);
  });

  test("a listener subscribed to all hears the Reviews nobody names", async () => {
    await start();
    const a = await openReview("a.md");
    const chat = await listen("chat");
    await subscribe(chat, "all");
    const agent = await listen("agent");
    await subscribe(agent, [a.review_id]);

    const b = await openReview("b.md");
    const remark = chat.until("feedback_item");
    await sendFeedback(b.link, [COMMENT]);
    expect((await remark).at(-1)).toMatchObject({ type: "feedback_item", review_id: b.review_id });
  });

  test("keeping a Review in a new subscription keeps the place; a replacing socket joins the back", async () => {
    await start();
    const a = await openReview("a.md");
    const b = await openReview("b.md");
    const s1 = await listen("s1");
    await subscribe(s1, [a.review_id]);
    const s2 = await listen("s2");
    await subscribe(s2, [a.review_id]);
    await subscribe(s1, [a.review_id, b.review_id]);
    let from = s2.messages.length;

    const toS1 = s1.until("feedback_item");
    await sendFeedback(a.link, [COMMENT]);
    await toS1;
    expect(await typesFrom(s2, from)).toEqual([]);
    expect((await list()).reviews.find((review) => review.review_id === a.review_id)?.listeners).toEqual(["s1", "s2"]);

    // The Remark s1 received and nobody answered goes with the Review to s2.
    const handedOver = s2.until("feedback_item");
    const replacing = await listen("s1");
    await handedOver;
    await subscribe(replacing, [a.review_id]);
    from = s2.messages.length;
    const toS2 = s2.until("feedback_item");
    await sendFeedback(a.link, [DELETION]);
    expect((await toS2).at(-1)).toMatchObject({ anchor: { tag: "deletion" } });
    expect(await typesFrom(s2, from)).toEqual(["feedback_item"]);
    expect(await typesFrom(replacing, replacing.messages.length)).toEqual([]);
    expect((await list()).reviews.find((review) => review.review_id === a.review_id)?.listeners).toEqual(["s2", "s1"]);
  });

  test("an unanswered Remark falls back to the listener subscribed to all when the holder's socket closes", async () => {
    await start();
    const review = await openReview("plan.md");
    const chat = await listen("chat");
    await subscribe(chat, "all");
    const agent = await listen("agent");
    await subscribe(agent, [review.review_id]);
    const received = agent.until("feedback_item");
    await sendFeedback(review.link, [COMMENT]);
    await received;
    const from = chat.messages.length;

    agent.socket.close();
    await lineIs(review.review_id, ["chat"]);
    await sendFeedback(review.link, [DELETION]);
    const frames = await typesFrom(chat, from);
    expect(frames).toEqual(["feedback_item", "feedback_item"]);
    expect(chat.messages.slice(from, from + 2)).toMatchObject([{ text: "Say why." }, { anchor: { tag: "deletion" } }]);
  });

  test("a pending Close falls back with the Review when the holder's subscription drops it", async () => {
    await start();
    const review = await openReview("plan.md");
    const chat = await listen("chat");
    await subscribe(chat, "all");
    const agent = await listen("agent");
    await subscribe(agent, [review.review_id]);
    const closed = agent.until("finish");
    expect((await post(`${review.link}api/exit`)).status).toBe(200);
    expect((await closed).at(-1)).toMatchObject({ type: "finish", dismissed: true });
    const from = chat.messages.length;

    const handedOver = chat.until("finish");
    await subscribe(agent, []);
    expect((await handedOver).at(-1)).toMatchObject({ type: "finish", review_id: review.review_id, dismissed: true });
    expect(await typesFrom(chat, from)).toEqual(["finish"]);
  });

  test("a Remark answered before the hand-over is not handed over", async () => {
    await start();
    const review = await openReview("plan.md");
    const chat = await listen("chat");
    await subscribe(chat, "all");
    const agent = await listen("agent");
    await subscribe(agent, [review.review_id]);
    const received = agent.until("feedback_item");
    await sendFeedback(review.link, [COMMENT]);
    const remark = (await received).at(-1);
    expect((await reply(review.review_id, [remark && "id" in remark ? remark.id : ""])).status).toBe(200);
    const from = chat.messages.length;

    agent.socket.close();
    await lineIs(review.review_id, ["chat"]);
    expect(await typesFrom(chat, from)).toEqual([]);
  });

  test("a listener that names the Review takes it over from the listener subscribed to all", async () => {
    await start();
    const review = await openReview("plan.md");
    const chat = await listen("chat");
    await subscribe(chat, "all");
    const received = chat.until("feedback_item");
    await sendFeedback(review.link, [COMMENT]);
    await received;

    const agent = await listen("agent");
    expect((await subscribe(agent, [review.review_id])).map((frame) => frame.type)).toEqual(["feedback_item", "subscribed"]);
    const from = chat.messages.length;
    const later = agent.until("feedback_item");
    await sendFeedback(review.link, [DELETION]);
    await later;
    expect(await typesFrom(chat, from)).toEqual([]);
  });

  test("a holder dropped after a missed ping hands the Review over", async () => {
    await start({ heartbeatMs: 50 });
    const review = await openReview("plan.md");
    const end = await silentListener("agent", [review.review_id]);
    await lineIs(review.review_id, ["agent"]);
    const chat = await listen("chat");
    await subscribe(chat, "all");
    await lineIs(review.review_id, ["chat"]);

    const remark = chat.until("feedback_item");
    await sendFeedback(review.link, [COMMENT]);
    expect((await remark).at(-1)).toMatchObject({ type: "feedback_item", review_id: review.review_id });
    end();
  });
});

describe("A subscription replays only the Reviews its listener holds", () => {
  test("adding a Review on an open socket replays that Review only", async () => {
    await start();
    const a = await openReview("a.md");
    const b = await openReview("b.md");
    const listener = await listen("agent");
    await subscribe(listener, [a.review_id]);
    const received = listener.until("feedback_item");
    await sendFeedback(a.link, [COMMENT]);
    await received;
    await sendFeedback(b.link, [DELETION]);

    const replay = await subscribe(listener, [a.review_id, b.review_id]);
    expect(replay.map((frame) => frame.type)).toEqual(["feedback_item", "subscribed"]);
    expect(replay[0]).toMatchObject({ review_id: b.review_id });
  });

  test("subscribing to all skips a Review another listener names", async () => {
    await start();
    const a = await openReview("a.md");
    const b = await openReview("b.md");
    const agent = await listen("agent");
    await subscribe(agent, [a.review_id]);
    await sendFeedback(a.link, [COMMENT]);
    await sendFeedback(b.link, [DELETION]);

    const chat = await listen("chat");
    const replay = await subscribe(chat, "all");
    expect(replay.map((frame) => frame.type)).toEqual(["feedback_item", "subscribed"]);
    expect(replay[0]).toMatchObject({ review_id: b.review_id });
  });

  test("a listener behind the holder gets no replay and nobody hears about it", async () => {
    await start();
    const review = await openReview("plan.md");
    const s1 = await listen("s1");
    await subscribe(s1, [review.review_id]);
    const finish = s1.until("finish");
    await post(`${review.link}api/approve`, { feedback: "", draftGeneration: 1 });
    await finish;
    const from = s1.messages.length;

    const s2 = await listen("s2");
    expect((await subscribe(s2, [review.review_id])).map((frame) => frame.type)).toEqual(["subscribed"]);
    const all = await listen("s3");
    expect((await subscribe(all, "all")).map((frame) => frame.type)).toEqual(["subscribed"]);
    expect(await typesFrom(s1, from)).toEqual([]);
  });

  test("a page load sends no frame and shows as last_page_open", async () => {
    await start();
    const review = await openReview("plan.md");
    const listener = await listen("agent");
    await subscribe(listener, [review.review_id]);
    const from = listener.messages.length;

    expect((await fetch(review.link)).status).toBe(200);
    expect(await typesFrom(listener, from)).toEqual([]);
    expect((await list()).reviews[0].last_page_open).not.toBeNull();
  });
});

describe("Rounds, Approve, Cancel and list", () => {
  test("Approve with notes finishes the Round; each next holder gets the Finish until it is acknowledged", async () => {
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
    expect((await subscribe(later, "all")).map((frame) => frame.type)).toEqual(["subscribed"]);
    const handedOver = later.until("finish");
    live.socket.close();
    const replay = await handedOver;
    expect(replay.map((frame) => frame.type)).toEqual(["feedback_item", "finish"]);
    const noticeId = replay[1].type === "finish" ? replay[1].id : "";
    expect(noticeId).toMatch(/^nt_[0-9a-f]{24}$/);

    later.socket.send(JSON.stringify({ type: "ack", id: noticeId }));
    later.socket.send(JSON.stringify({ type: "ack", id: noticeId }));
    const third = await listen("session-c");
    expect((await subscribe(third, "all")).map((frame) => frame.type)).toEqual(["subscribed"]);
    const from = third.messages.length;
    const remark = third.until("feedback_item");
    later.socket.close();
    await remark;
    expect(await typesFrom(third, from)).toEqual(["feedback_item"]);
    expect(later.messages.filter((frame) => frame.type === "error")).toEqual([]);
  });

  test("Approve without notes, and Close, finish with empty notes; only Close is dismissed", async () => {
    await start();
    const first = await openReview("plan.md");
    const second = await openReview("brief.md");
    const listener = await listen("session-a");
    await subscribe(listener, "all");

    let finish = listener.until("finish");
    expect((await post(`${first.link}api/approve`, { draftGeneration: 1 })).status).toBe(200);
    const approved = (await finish).at(-1);
    expect(approved).toMatchObject({ review_id: first.review_id, notes: "" });
    expect(approved).not.toHaveProperty("dismissed");

    finish = listener.until("finish");
    expect((await post(`${second.link}api/exit?draftGeneration=1&round=1`)).status).toBe(200);
    expect((await finish).at(-1)).toMatchObject({ review_id: second.review_id, notes: "", dismissed: true });
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

  test("a page command whose body arrives after the next Round opened is refused and keeps that Round's draft", async () => {
    await start();
    const review = await openReview("plan.md");
    const body = JSON.stringify({ annotations: [COMMENT], round: 1 });
    const { port } = new URL(service!.url);
    const answered = Promise.withResolvers<string>();
    let received = "";
    const socket = await Bun.connect({
      hostname: "127.0.0.1",
      port: Number(port),
      socket: {
        data: (_socket, chunk) => {
          received += chunk.toString();
          if (received.includes("\r\n\r\n{")) answered.resolve(received);
        },
      },
    });
    socket.write(
      `POST ${new URL(review.link).pathname}api/feedback HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n`,
    );
    // The service exposes no signal for "headers routed, body awaited"; a real pause lets it
    // route the request over the socket before the Round moves on, which is the race under test.
    await Bun.sleep(50);
    await post(`${service!.url}/api/review/v1/reviews/${review.review_id}/cancel`);
    expect(await openFile(join(dir, "plan.md"))).toMatchObject({ round: 2 });
    expect((await post(`${review.link}api/draft`, { annotations: [DELETION] })).status).toBe(200);

    socket.write(body);
    const answer = await answered.promise;
    socket.end();
    expect(answer).toStartWith("HTTP/1.1 409");
    expect(answer).toContain('"status":"stale-round"');
    expect(await (await fetch(`${review.link}api/draft`)).json()).toMatchObject({ annotations: [DELETION] });
    expect((await list()).reviews[0].open_item_count).toBe(0);
  });
});

describe("Replies on a Remark", () => {
  async function pageReplies(link: string): Promise<ReviewRepliesResponse> {
    const answer = await fetch(`${link}api/review-replies`);
    expect(answer.status).toBe(200);
    return (await answer.json()) as ReviewRepliesResponse;
  }

  test("a Reply answers its Remark, which is no longer replayed, and the page shows it under that Remark after a restart", async () => {
    await start();
    const review = await openReview("plan.md");
    await sendFeedback(review.link, [COMMENT, DELETION]);
    const [comment, deletion] = (await list(join(dir, "plan.md"))).reviews[0].open_items!;

    const sent = await post(`${service!.url}/api/review/v1/reviews/${review.review_id}/replies`, {
      text: "Said why.",
      answers: [comment.id, comment.id],
    });
    expect(sent.status).toBe(200);
    const answer = (await sent.json()) as ReplyResponse;
    expect(answer).toMatchObject({ status: "sent", answered: [comment.id] });
    expect(answer.reply).toMatchObject({ review_id: review.review_id, text: "Said why.", answers: [comment.id] });
    expect(answer.reply.id).toMatch(/^rp_[0-9a-f]{24}$/);

    const listener = await listen("session-a");
    const replay = await subscribe(listener, [review.review_id]);
    expect(replay.filter((frame) => frame.type === "feedback_item").map((frame) => "id" in frame && frame.id)).toEqual([deletion.id]);
    expect((await list()).reviews[0].open_item_count).toBe(1);

    listener.socket.close();
    await service!.stop();
    await start();
    // The restarted service picked another free port; the page path stays.
    const shown = await pageReplies(`${service!.url}${new URL(review.link).pathname}`);
    expect(shown.review_id).toBe(review.review_id);
    expect(shown.remarks.map((remark) => [remark.id, remark.status, remark.replies.map((reply) => reply.id)])).toEqual([
      [comment.id, "answered", [answer.reply.id]],
      [deletion.id, "open", []],
    ]);
    expect(shown.remarks[0]).toMatchObject({ round: 1, text: "Say why.", anchor: { selector: "block-2", tag: "comment" } });
    expect(shown.replies).toEqual([]);
  });

  test("a Reply naming an unknown Remark writes nothing; one naming none shows apart; an ended Review takes Replies", async () => {
    await start();
    const review = await openReview("plan.md");
    await sendFeedback(review.link, [COMMENT]);
    const [comment] = (await list(join(dir, "plan.md"))).reviews[0].open_items!;
    const replies = `${service!.url}/api/review/v1/reviews/${review.review_id}/replies`;

    const refused = await post(replies, { text: "Done.", answers: [comment.id, "fi_000000000000000000000000"] });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: "unknown feedback items", unknown: ["fi_000000000000000000000000"] });
    expect((await post(replies, { text: "  " })).status).toBe(400);
    expect((await pageReplies(review.link)).remarks[0]).toMatchObject({ status: "open", replies: [] });

    await post(`${service!.url}/api/review/v1/reviews/${review.review_id}/cancel`);
    const general = (await (await post(replies, { text: "Reworked the plan." })).json()) as ReplyResponse;
    expect(general.answered).toEqual([]);
    const shown = await pageReplies(review.link);
    expect(shown.replies.map((reply) => reply.id)).toEqual([general.reply.id]);
    expect(shown.remarks[0]).toMatchObject({ status: "open", replies: [] });

    expect((await post(`${service!.url}/api/review/v1/reviews/ffffffffffffffff/replies`, { text: "x" })).status).toBe(404);
  });

  test("a Reply stored before its Remarks were rewritten still answers them after a restart", async () => {
    await start();
    const review = await openReview("plan.md");
    await sendFeedback(review.link, [COMMENT]);
    const [comment] = (await list(join(dir, "plan.md"))).reviews[0].open_items!;
    await service!.stop();
    // As if the service stopped after writing replies.json, before remarks.json.
    const reply = { id: "rp_0123456789abcdef01234567", review_id: review.review_id, text: "Done.", answers: [comment.id], at: comment.at };
    writeFileSync(join(reviewsDir, review.review_id, "replies.json"), JSON.stringify({ replies: [reply] }));

    await start();
    const listener = await listen("session-a");
    expect((await subscribe(listener, "all")).map((frame) => frame.type)).toEqual(["subscribed"]);
    expect((await pageReplies(`${service!.url}${new URL(review.link).pathname}`)).remarks[0]).toMatchObject({
      status: "answered",
      replies: [reply],
    });
  });
});
