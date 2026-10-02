/// <reference types="bun-types" />
/** Missing review-api delta scenarios, through real HTTP and listen sockets. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ListenServerMessage, OpenReviewResponse } from "../../packages/shared/review-api";
import { startAnnotateServer } from "../../packages/server/annotate";
import { startReviewService, type ReviewService } from "../../packages/server/review-service/service";

let dir: string;
let service: ReviewService | undefined;
const sockets: WebSocket[] = [];
const rawEnds: (() => void)[] = [];
const saved: Record<string, string | undefined> = {};

beforeEach(async () => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "plannotator-listen-contract-")));
  for (const key of ["PLANNOTATOR_PORT", "PLANNOTATOR_REMOTE", "PLANNOTATOR_DATA_DIR"]) saved[key] = process.env[key];
  delete process.env.PLANNOTATOR_PORT;
  process.env.PLANNOTATOR_REMOTE = "0";
  process.env.PLANNOTATOR_DATA_DIR = join(dir, "data");
  service = await startReviewService({
    port: 0,
    reviewsDir: join(dir, "reviews"),
    version: "test",
    heartbeatMs: 250,
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
});

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  for (const end of rawEnds.splice(0)) end();
  await service?.stop();
  service = undefined;
  rmSync(dir, { recursive: true, force: true });
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function openReview(): Promise<OpenReviewResponse> {
  const file = join(dir, "plan.md");
  writeFileSync(file, "# Plan\n\nName the owner.\n");
  const answer = await fetch(`${service!.url}/api/review/v1/reviews`, {
    method: "POST",
    body: JSON.stringify({ file }),
  });
  expect(answer.status).toBe(200);
  return await answer.json() as OpenReviewResponse;
}

type Listener = {
  socket: WebSocket;
  messages: ListenServerMessage[];
  until: (type: ListenServerMessage["type"]) => Promise<ListenServerMessage[]>;
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
  const opened = Promise.withResolvers<void>();
  socket.addEventListener("open", () => opened.resolve());
  socket.addEventListener("error", opened.reject);
  await opened.promise;
  return {
    socket,
    messages,
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

async function sendRemark(link: string): Promise<void> {
  const answer = await fetch(`${link}api/feedback`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      feedback: "Name the owner.",
      annotations: [{ id: "a1", blockId: "block-2", type: "COMMENT", text: "Name the owner.", originalText: "Name the owner.", startOffset: 0, endOffset: 15, createdA: 1 }],
      codeAnnotations: [],
      draftGeneration: 1,
    }),
  });
  expect(answer.status).toBe(200);
}

/** A real socket that reads its Remark but deliberately never answers a ping. */
async function silentListener(reviewId: string): Promise<PromiseWithResolvers<unknown>> {
  const { hostname, port } = new URL(service!.url);
  const upgraded = Promise.withResolvers<void>();
  const subscribed = Promise.withResolvers<void>();
  const remark = Promise.withResolvers<unknown>();
  let buffer = Buffer.alloc(0);
  let handshake = true;
  const socket = await Bun.connect({
    hostname,
    port: Number(port),
    socket: {
      data: (_socket, chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        if (handshake) {
          const end = buffer.indexOf("\r\n\r\n");
          if (end === -1) return;
          expect(buffer.subarray(0, end).toString()).toStartWith("HTTP/1.1 101");
          buffer = buffer.subarray(end + 4);
          handshake = false;
          upgraded.resolve();
        }
        while (buffer.length >= 2) {
          const opcode = buffer[0] & 0x0f;
          let length = buffer[1] & 0x7f;
          let offset = 2;
          if (length === 126) {
            if (buffer.length < 4) return;
            length = buffer.readUInt16BE(2);
            offset = 4;
          } else if (length === 127) {
            if (buffer.length < 10) return;
            length = Number(buffer.readBigUInt64BE(2));
            offset = 10;
          }
          if (buffer.length < offset + length) return;
          const payload = buffer.subarray(offset, offset + length);
          buffer = buffer.subarray(offset + length);
          if (opcode !== 1) continue; // Including ping: no pong is sent.
          const frame: unknown = JSON.parse(payload.toString());
          if (frame && typeof frame === "object" && "type" in frame) {
            if (frame.type === "subscribed") subscribed.resolve();
            if (frame.type === "feedback_item") remark.resolve(frame);
          }
        }
      },
    },
  });
  rawEnds.push(() => socket.end());
  socket.write(
    `GET /api/review/v1/listen?session=silent-agent HTTP/1.1\r\nHost: ${hostname}:${port}\r\nUpgrade: websocket\r\n` +
      "Connection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n",
  );
  await upgraded.promise;
  const payload = Buffer.from(JSON.stringify({ type: "subscribe", reviews: [reviewId] }));
  const mask = [1, 2, 3, 4];
  socket.write(Buffer.from([0x81, 0x80 | payload.length, ...mask, ...payload.map((byte, index) => byte ^ mask[index % 4])]));
  await subscribed.promise;
  return remark;
}

describe("Listen socket messages", () => {
  test("Subscribing is confirmed with the normalized subscription", async () => {
    const review = await openReview();
    const listener = await listen("agent");
    expect(await subscribe(listener, [review.review_id, review.review_id])).toEqual([
      { type: "subscribed", reviews: [review.review_id] },
    ]);
  });

  test("A bad frame is refused and the socket stays open", async () => {
    const review = await openReview();
    const listener = await listen("agent");
    const refused = listener.until("error");
    listener.socket.send("not json");
    expect(await refused).toMatchObject([{ type: "error" }]);
    expect(await subscribe(listener, [review.review_id])).toEqual([
      { type: "subscribed", reviews: [review.review_id] },
    ]);
  });

  test("Another listener on the same Review is not announced", async () => {
    const review = await openReview();
    const chat = await listen("chat");
    await subscribe(chat, "all");
    const from = chat.messages.length;
    const agent = await listen("agent");
    expect(await subscribe(agent, [review.review_id])).toEqual([
      { type: "subscribed", reviews: [review.review_id] },
    ]);
    // The error is a socket barrier: any earlier announcement precedes it.
    const probe = chat.until("error");
    chat.socket.send(JSON.stringify({ type: "ack", id: "nt_000000000000000000000000" }));
    await probe;
    expect(chat.messages.slice(from, -1)).toEqual([]);
  });
});

describe("Holder backlog hand-over", () => {
  test("Re-subscribing to all keeps its place, then closing hands the open Remark to the next all listener", async () => {
    const review = await openReview();
    const first = await listen("first");
    await subscribe(first, "all");
    const second = await listen("second");
    await subscribe(second, "all");
    const from = second.messages.length;
    expect(await subscribe(first, "all")).toEqual([{ type: "subscribed", reviews: "all" }]);
    const live = first.until("feedback_item");
    await sendRemark(review.link);
    const received = (await live).at(-1);
    expect(received).toMatchObject({ type: "feedback_item", review_id: review.review_id, text: "Name the owner." });
    const probe = second.until("error");
    second.socket.send(JSON.stringify({ type: "ack", id: "nt_000000000000000000000000" }));
    await probe;
    expect(second.messages.slice(from, -1)).toEqual([]);
    const listed = await (await fetch(`${service!.url}/api/review/v1/reviews`)).json();
    expect(listed.reviews[0].listeners).toEqual(["first", "second"]);
    const handedOver = second.until("feedback_item");
    first.socket.close();
    const replay = await handedOver;
    expect(replay).toHaveLength(1);
    expect(received).toEqual(replay[0]);
  });

  test("A holder dropped by the heartbeat hands over the open Remark it already received", async () => {
    const review = await openReview();
    const chat = await listen("chat");
    await subscribe(chat, "all");
    const agent = await silentListener(review.review_id);
    const handedOver = chat.until("feedback_item");
    await sendRemark(review.link);
    const received = await agent.promise;
    expect(received).toMatchObject({ type: "feedback_item", review_id: review.review_id, text: "Name the owner." });
    const replay = await handedOver;
    expect(replay).toHaveLength(1);
    expect(received).toEqual(replay[0]);
    const listed = await (await fetch(`${service!.url}/api/review/v1/reviews`)).json();
    expect(listed.reviews[0].listeners).toEqual(["chat"]);
  });
});
