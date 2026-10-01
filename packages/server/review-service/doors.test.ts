/**
 * The doors against the real service: each serves only the Reviews of its Visibility
 * and their page, checked per request; everything else, the review API included, is
 * 404; it answers only its hostnames, forbids framing, keeps this Mac's paths off the
 * page, rate-limits visitors, refuses WebSockets, drops other peers, and closes a
 * Review's open streams when the Review's Visibility stops being the door's.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OpenReviewResponse, ReviewRepliesResponse, Visibility } from "@plannotator/shared/review-api";
import { startAnnotateServer } from "../annotate";
import type { DoorListen } from "./doors";
import { startReviewService, type ReviewService, type ReviewServiceOptions } from "./service";

let dir: string;
let service: ReviewService | undefined;
const saved: Record<string, string | undefined> = {};

/** Starts the service with [doors]; answers each started door's loopback origin, in start order. */
async function startWith(doors: Pick<ReviewServiceOptions, "publicDoor" | "temporaryPort" | "temporaryOrigin" | "doorRateLimit">): Promise<string[]> {
  service = await startReviewService({
    port: 0,
    reviewsDir: join(dir, "reviews"),
    version: "test",
    log: () => {},
    ...doors,
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
  await Promise.all(service.doors.map((door) => door.bound));
  return service.doors.map((door) => `http://127.0.0.1:${door.port()}`);
}

async function start(publicDoor: DoorListen, doorRateLimit?: number): Promise<string> {
  const [door] = await startWith({ publicDoor, doorRateLimit });
  return door;
}

const LOOPBACK_DOOR: DoorListen = { host: "127.0.0.1", port: 0, peer: "127.0.0.1" };

async function openReview(name: string, visibility: Visibility): Promise<OpenReviewResponse> {
  const file = join(dir, name);
  writeFileSync(file, `# ${name}\n\nFirst paragraph.\n`);
  const answer = await fetch(`${service!.url}/api/review/v1/reviews`, {
    method: "POST",
    body: JSON.stringify({ file: realpathSync(file), visibility }),
  });
  return (await answer.json()) as OpenReviewResponse;
}

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "pn-review-door-")));
  for (const key of ["PLANNOTATOR_PORT", "PLANNOTATOR_REMOTE", "PLANNOTATOR_DATA_DIR"]) saved[key] = process.env[key];
  delete process.env.PLANNOTATOR_PORT;
  process.env.PLANNOTATOR_REMOTE = "0";
  process.env.PLANNOTATOR_DATA_DIR = join(dir, "data");
});

afterEach(async () => {
  await service?.stop();
  service = undefined;
  rmSync(dir, { recursive: true, force: true });
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("the public door serves public Reviews and their page only, without this Mac's paths", async () => {
  const door = await start(LOOPBACK_DOOR);
  const shared = await openReview("shared.md", "public");
  const local = await openReview("local.md", "local");
  expect(shared.link).toBe(`https://ctas.de-appspecialist.nl/plannotator/session/${shared.review_id}/`);
  const page = `/plannotator/session/${shared.review_id}/`;

  const health = await fetch(`${door}/plannotator/health`);
  expect(health.status).toBe(200);
  expect(await health.json()).toMatchObject({ ok: true, app: "plannotator" });
  expect(health.headers.get("x-frame-options")).toBe("DENY");
  expect(health.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");

  const html = await fetch(`${door}${page}`);
  expect(html.status).toBe(200);
  expect(await html.text()).toContain("Plannotator page");
  expect(html.headers.get("x-frame-options")).toBe("DENY");
  expect((await fetch(`${door}/plannotator/session/${shared.review_id}`, { redirect: "manual" })).headers.get("location")).toBe(page);

  const plan = await fetch(`${door}${page}api/plan`);
  expect(plan.status).toBe(200);
  const planData: Record<string, unknown> = await plan.json();
  expect(planData.plan).toContain("# shared.md");
  expect(planData.filePath).toBe("shared.md");
  expect(planData).not.toHaveProperty("projectRoot");
  expect(planData.sourceSave).toEqual({ enabled: false, reason: "not-local-file" });
  expect(JSON.stringify(planData)).not.toContain(dir);

  const feedback = await fetch(`${door}${page}api/feedback`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ feedback: "x", annotations: [{ id: "a1", blockId: "block-1", type: "COMMENT", text: "From ctas." }] }),
  });
  expect(feedback.status).toBe(200);
  const replies: ReviewRepliesResponse = await (await fetch(`${door}${page}api/review-replies`)).json();
  expect(replies.remarks).toHaveLength(1);

  for (const path of [
    `/plannotator/session/${local.review_id}/`,
    `/plannotator/session/${local.review_id}/api/plan`,
    `/plannotator/session/ffffffffffffffff/`,
    `${page}api/image?path=/etc/hosts`,
    `${page}api/doc?path=/etc/hosts`,
    `${page}api/reference/files`,
    "/api/review/version",
    "/api/review/v1/reviews",
    `/api/review/v1/reviews?file=${encodeURIComponent(join(dir, "shared.md"))}`,
    "/",
  ]) {
    expect([path, (await fetch(`${door}${path}`)).status]).toEqual([path, 404]);
  }

  // A local sibling's saved versions stay on this Mac: the version routes take no `path` or `base` through a door.
  expect((await fetch(`${service!.url}/plannotator/session/${local.review_id}/api/plan`)).status).toBe(200);
  const siblingThroughService = await fetch(`${service!.url}${page}api/plan/versions?path=local.md`);
  expect(siblingThroughService.status).toBe(200);
  expect((await fetch(`${door}${page}api/plan/versions`)).status).toBe(200);
  for (const query of ["versions?path=local.md", `versions?path=${encodeURIComponent(join(dir, "local.md"))}`, "version?path=local.md&v=1", "version?v=1&base=/etc"]) {
    expect([query, (await fetch(`${door}${page}api/plan/${query}`)).status]).toEqual([query, 404]);
  }
  const refusedOpen = await fetch(`${door}/api/review/v1/reviews`, { method: "POST", body: JSON.stringify({ file: join(dir, "local.md") }) });
  expect(refusedOpen.status).toBe(404);
  const refusedCancel = await fetch(`${door}/api/review/v1/reviews/${shared.review_id}/cancel`, { method: "POST" });
  expect(refusedCancel.status).toBe(404);
});

test("the door answers only its hostnames and refuses WebSockets", async () => {
  const door = await start(LOOPBACK_DOOR);
  const shared = await openReview("shared.md", "public");
  const page = `${door}/plannotator/session/${shared.review_id}/`;

  expect((await fetch(page, { headers: { host: "ctas.de-appspecialist.nl" } })).status).toBe(200);
  expect((await fetch(page, { headers: { host: "evil.example" } })).status).toBe(404);
  expect((await fetch(page, { headers: { "x-forwarded-host": "evil.example" } })).status).toBe(404);

  const socket = new WebSocket(`${door.replace("http", "ws")}/api/review/v1/listen?session=s1`);
  const outcome = Promise.withResolvers<string>();
  socket.addEventListener("open", () => outcome.resolve("open"));
  socket.addEventListener("error", () => outcome.resolve("refused"));
  expect(await outcome.promise).toBe("refused");
});

test("a Review made local is no longer served and its open stream through the door closes", async () => {
  const door = await start(LOOPBACK_DOOR);
  const shared = await openReview("shared.md", "public");
  const page = `${door}/plannotator/session/${shared.review_id}/`;

  const stream = await fetch(`${page}api/review-round`);
  expect(stream.status).toBe(200);
  const reader = stream.body!.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toContain(`"round":1`);

  const changed = await fetch(`${service!.url}/api/review/v1/reviews/${shared.review_id}/visibility`, {
    method: "POST",
    body: JSON.stringify({ visibility: "local" }),
  });
  expect(changed.status).toBe(200);
  const ended = await reader.read().then(
    (result) => (result.done ? "closed" : "data"),
    () => "closed",
  );
  expect(ended).toBe("closed");
  expect((await fetch(page)).status).toBe(404);
});

test("each visitor is rate-limited on the proxy's last X-Forwarded-For entry", async () => {
  const door = await start(LOOPBACK_DOOR, 2);
  const visitor = { "x-forwarded-for": "203.0.113.9, 198.51.100.7" };
  expect((await fetch(`${door}/plannotator/health`, { headers: visitor })).status).toBe(200);
  expect((await fetch(`${door}/plannotator/health`, { headers: visitor })).status).toBe(200);
  const limited = await fetch(`${door}/plannotator/health`, { headers: visitor });
  expect(limited.status).toBe(429);
  expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
  expect((await fetch(`${door}/plannotator/health`, { headers: { "x-forwarded-for": "198.51.100.8" } })).status).toBe(200);
});

test("a connection from any address but the peer is dropped", async () => {
  const door = await start({ host: "127.0.0.1", port: 0, peer: "127.0.0.2" });
  const outcome = await fetch(`${door}/plannotator/health`).then(
    (answer) => `answered ${answer.status}`,
    () => "dropped",
  );
  expect(outcome).toBe("dropped");
});

const NGROK = { host: "t.example" };

test("the temporary door serves temporary Reviews for the link's host only; the public door does not", async () => {
  const [publicDoor, temporaryDoor] = await startWith({ publicDoor: LOOPBACK_DOOR, temporaryPort: 0, temporaryOrigin: "https://t.example" });
  const temporary = await openReview("temporary.md", "temporary");
  const shared = await openReview("shared.md", "public");
  const local = await openReview("local.md", "local");
  expect(temporary.link).toBe(`https://t.example/plannotator/session/${temporary.review_id}/`);
  const page = `/plannotator/session/${temporary.review_id}/`;

  expect((await fetch(`${temporaryDoor}/plannotator/health`, { headers: NGROK })).status).toBe(200);
  const html = await fetch(`${temporaryDoor}${page}`, { headers: NGROK });
  expect(html.status).toBe(200);
  expect(await html.text()).toContain("Plannotator page");
  expect(html.headers.get("x-frame-options")).toBe("DENY");
  const planData: Record<string, unknown> = await (await fetch(`${temporaryDoor}${page}api/plan`, { headers: NGROK })).json();
  expect(planData.filePath).toBe("temporary.md");
  expect(JSON.stringify(planData)).not.toContain(dir);
  expect((await fetch(`${temporaryDoor}${page}api/review-replies`, { headers: NGROK })).status).toBe(200);
  const round = await fetch(`${temporaryDoor}${page}api/review-round`, { headers: NGROK });
  expect(round.status).toBe(200);
  await round.body!.cancel();

  for (const path of [`/plannotator/session/${shared.review_id}/`, `/plannotator/session/${local.review_id}/`, "/api/review/v1/reviews"]) {
    expect([path, (await fetch(`${temporaryDoor}${path}`, { headers: NGROK })).status]).toEqual([path, 404]);
  }
  // The door's own loopback address and the ctas host are not the link's host.
  expect((await fetch(`${temporaryDoor}${page}`)).status).toBe(404);
  expect((await fetch(`${temporaryDoor}${page}`, { headers: { host: "ctas.de-appspecialist.nl" } })).status).toBe(404);
  expect((await fetch(`${publicDoor}${page}`, { headers: { host: "ctas.de-appspecialist.nl" } })).status).toBe(404);

  const socket = new WebSocket(`${temporaryDoor.replace("http", "ws")}/api/review/v1/listen?session=s1`, { headers: NGROK });
  const outcome = Promise.withResolvers<string>();
  socket.addEventListener("open", () => outcome.resolve("open"));
  socket.addEventListener("error", () => outcome.resolve("refused"));
  expect(await outcome.promise).toBe("refused");
});

test("a temporary Review made public closes its open stream through the temporary door", async () => {
  const [temporaryDoor] = await startWith({ temporaryPort: 0, temporaryOrigin: "https://t.example" });
  const temporary = await openReview("temporary.md", "temporary");
  const page = `${temporaryDoor}/plannotator/session/${temporary.review_id}/`;

  const reader = (await fetch(`${page}api/review-round`, { headers: NGROK })).body!.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toContain(`"round":1`);
  const changed = await fetch(`${service!.url}/api/review/v1/reviews/${temporary.review_id}/visibility`, {
    method: "POST",
    body: JSON.stringify({ visibility: "public" }),
  });
  expect(changed.status).toBe(200);
  const ended = await reader.read().then(
    (result) => (result.done ? "closed" : "data"),
    () => "closed",
  );
  expect(ended).toBe("closed");
  expect((await fetch(page, { headers: NGROK })).status).toBe(404);
});
