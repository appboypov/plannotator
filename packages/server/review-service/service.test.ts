/**
 * The review service against real upstream annotate servers: many documents at once,
 * a lasting id per file, each page answering its own document, state that survives
 * a restart, and the contract's refusals.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ListReviewsResponse, OpenReviewResponse } from "@plannotator/shared/review-api";
import { startAnnotateServer } from "../annotate";
import { startReviewService, type ReviewService } from "./service";
import type { StartReviewPage } from "./pages";
import { resolveServiceSettings } from "./settings";

const SHELL = "<html><body>Plannotator page</body></html>";

let dir: string;
let reviewsDir: string;
let service: ReviewService | undefined;
let pageStarts: number;
const saved: Record<string, string | undefined> = {};

const startPage: StartReviewPage = async (review) => {
  pageStarts += 1;
  const page = await startAnnotateServer({
    markdown: readFileSync(review.file, "utf8"),
    filePath: review.file,
    htmlContent: SHELL,
    gate: true,
  });
  return { port: page.port, stop: page.stop };
};

async function start(multicaProfile: string | null = null): Promise<ReviewService> {
  service = await startReviewService({ port: 0, reviewsDir, version: "test", startPage, log: () => {}, multicaProfile, multicaHome: dir });
  return service;
}

async function open(file: string, extra: Record<string, unknown> = {}): Promise<Response> {
  return fetch(`${service!.url}/api/review/v1/reviews`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file, ...extra }),
  });
}

function document(name: string, content: string): string {
  const file = join(dir, name);
  writeFileSync(file, content);
  return realpathSync(file);
}

/** The document a Review's page serves on its `api/plan`. */
async function planOf(link: string): Promise<unknown> {
  const answer = await fetch(`${link}api/plan`);
  expect(answer.status).toBe(200);
  const body: unknown = await answer.json();
  return body && typeof body === "object" && "plan" in body ? body.plan : undefined;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pn-review-service-"));
  reviewsDir = join(dir, "reviews");
  pageStarts = 0;
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

describe("review service", () => {
  test("serves two documents at once, each on its own lasting link", async () => {
    await start();
    const plan = document("plan.md", "# Plan\n\nShip the service.\n");
    const brief = document("brief.md", "# Brief\n\nOne link per document.\n");

    const first = (await (await open(plan)).json()) as OpenReviewResponse;
    const second = (await (await open(brief)).json()) as OpenReviewResponse;
    expect(first.review_id).toMatch(/^[0-9a-f]{16}$/);
    expect(second.review_id).toMatch(/^[0-9a-f]{16}$/);
    expect(second.review_id).not.toBe(first.review_id);
    expect(first).toMatchObject({ status: "opened", round: 1, visibility: "local" });
    expect(first.link).toBe(`${service!.url}/plannotator/session/${first.review_id}/`);

    expect(await planOf(first.link)).toBe("# Plan\n\nShip the service.\n");
    expect(await planOf(second.link)).toBe("# Brief\n\nOne link per document.\n");

    const again = (await (await open(plan)).json()) as OpenReviewResponse;
    expect(again).toEqual(first);
  });

  test("page Send feedback and Approve post three ordered comments; Cancel posts none", async () => {
    const comments: string[] = [];
    const received = Promise.withResolvers<void>();
    const fake = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: async (request) => {
      expect(request.headers.get("X-Workspace-ID")).toBe("W");
      comments.push((await request.json()).content);
      if (comments.length === 3) received.resolve();
      return Response.json({ id: `comment-${comments.length}` }, { status: 201 });
    } });
    try {
      const profileDir = join(dir, ".multica", "profiles", "scratch");
      mkdirSync(profileDir, { recursive: true });
      writeFileSync(join(profileDir, "config.json"), JSON.stringify({ server_url: fake.url.origin, token: "fake-token" }));
      await start("scratch");
      const issue = { id: "WORK-1", workspace_id: "W" };
      const { link } = await (await open(document("plan.md", "# Plan\n"), { issue })).json();
      expect((await fetch(`${link}api/feedback`, { method: "POST", body: JSON.stringify({
        round: 1, annotations: [{ type: "comment", blockId: "block-1", originalText: "Plan", text: "one" },
          { type: "comment", blockId: "block-2", originalText: "Ship", text: "two" }],
      }) })).status).toBe(200);
      expect((await fetch(`${link}api/approve`, { method: "POST", body: JSON.stringify({ round: 1, feedback: "ship" }) })).status).toBe(200);
      await received.promise;
      expect(comments.map((content) => content.match(/> (one|two|ship)/)?.[1])).toEqual(["one", "two", "ship"]);
      const cancelled = await (await open(document("cancel.md", "# Cancel\n"), { issue })).json();
      await fetch(`${service!.url}/api/review/v1/reviews/${cancelled.review_id}/cancel`, { method: "POST" });
      await service!.stop();
      expect(comments).toHaveLength(3);
      const notices = JSON.parse(readFileSync(join(reviewsDir, cancelled.review_id, "notices.json"), "utf8")).notices;
      expect(notices[0]).not.toHaveProperty("multica");
    } finally { fake.stop(true); }
  });

  test("a link posts a pre-link Remark and the current Round's Approve, never an earlier Round's", async () => {
    const comments: string[] = [];
    const received = Promise.withResolvers<void>();
    const fake = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: async (request) => {
      comments.push((await request.json()).content);
      if (comments.length === 3) received.resolve();
      return Response.json({ id: `comment-${comments.length}` }, { status: 201 });
    } });
    try {
      const profileDir = join(dir, ".multica", "profiles", "scratch");
      mkdirSync(profileDir, { recursive: true });
      writeFileSync(join(profileDir, "config.json"), JSON.stringify({ server_url: fake.url.origin, token: "fake-token" }));
      await start("scratch");
      const issue = { id: "WORK-1", workspace_id: "W" };
      const reopened = document("reopened.md", "# Reopened\n");
      const { link } = await (await open(reopened)).json();
      await fetch(`${link}api/feedback`, { method: "POST", body: JSON.stringify({
        round: 1, annotations: [{ type: "comment", blockId: "block-1", originalText: "Reopened", text: "pre-link" }] }) });
      await fetch(`${link}api/approve`, { method: "POST", body: JSON.stringify({ round: 1, feedback: "first round" }) });
      expect(await (await open(reopened, { issue, reopen: true })).json()).toMatchObject({ round: 2, issue });
      await fetch(`${link}api/approve`, { method: "POST", body: JSON.stringify({ round: 2, feedback: "second round" }) });
      const stays = document("stays.md", "# Stays\n");
      const finished = await (await open(stays)).json();
      await fetch(`${finished.link}api/approve`, { method: "POST", body: JSON.stringify({ round: 1, feedback: "stays finished" }) });
      expect(await (await open(stays, { issue })).json()).toMatchObject({ status: "user-ended", round: 1, issue });
      // A bound earlier-Round Approve would post before "second round" in its store order, so any three comments show it.
      await received.promise;
      await service!.stop();
      const quoted = comments.map((content) => content.match(/> (.+)/)?.[1]).sort();
      expect(quoted).toEqual(["pre-link", "second round", "stays finished"]);
    } finally { fake.stop(true); }
  });

  test("links, keeps, replaces and reloads an issue; a Review stored without issue lists as unlinked", async () => {
    await start("scratch");
    const file = document("linked.md", "# Plan\n");
    const issue = { id: "WORK-1", workspace_id: "W" };
    expect(await (await open(file, { issue })).json()).toMatchObject({ issue });
    expect(await (await open(file)).json()).toMatchObject({ issue });
    const replacement = { id: "WORK-2", workspace_id: "W2" };
    expect(await (await open(file, { issue: replacement })).json()).toMatchObject({ issue: replacement });
    const unlinked = await (await open(document("unlinked.md", "# Unlinked\n"))).json();
    const path = join(reviewsDir, unlinked.review_id, "review.json");
    const stored = JSON.parse(readFileSync(path, "utf8"));
    delete stored.issue;
    writeFileSync(path, JSON.stringify(stored));
    await service!.stop();
    await start("scratch");
    const list = await (await fetch(`${service!.url}/api/review/v1/reviews`)).json();
    expect(list.reviews.map((review: { issue: unknown }) => review.issue)).toEqual([replacement, null]);
  });

  test("refuses links before creating or changing a Review", async () => {
    await start(" ");
    const file = document("plan.md", "# Plan\n");
    expect((await open(file, { issue: { id: "WORK-1", workspace_id: "W" } })).status).toBe(400);
    expect((await (await fetch(`${service!.url}/api/review/v1/reviews`)).json()).reviews).toEqual([]);
    const original = await (await open(file)).json();
    for (const issue of [{ id: "WORK-1" }, { id: "WORK-1", workspace_id: " " }, { id: "WORK-1", workspace_id: "W" }]) {
      expect((await open(file, { issue, visibility: "public" })).status).toBe(400);
      expect(await (await open(file)).json()).toEqual(original);
    }
  });

  test("the same file through another path keeps its id", async () => {
    await start();
    const plan = document("plan.md", "# Plan\n");
    mkdirSync(join(dir, "links"));
    symlinkSync(plan, join(dir, "links", "plan.md"));

    const direct = (await (await open(plan)).json()) as OpenReviewResponse;
    const linked = (await (await open(join(dir, "links", "plan.md"))).json()) as OpenReviewResponse;
    expect(linked.review_id).toBe(direct.review_id);
  });

  test("serves the upstream page under the Review's path and starts it once", async () => {
    await start();
    const { review_id, link } = (await (await open(document("plan.md", "# Plan\n"))).json()) as OpenReviewResponse;

    const bare = await fetch(link.slice(0, -1), { redirect: "manual" });
    expect(bare.status).toBe(308);
    expect(bare.headers.get("location")).toBe(`/plannotator/session/${review_id}/`);

    const [page] = await Promise.all([fetch(link), fetch(`${link}api/plan`)]);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Plannotator page");
    expect(pageStarts).toBe(1);

    const listed = (await (await fetch(`${service!.url}/api/review/v1/reviews`)).json()) as ListReviewsResponse;
    expect(listed.reviews[0].last_page_open).not.toBeNull();
  });

  test("keeps every Review in its own folder across a restart", async () => {
    await start();
    const plan = document("plan.md", "# Plan\n");
    const brief = document("brief.md", "# Brief\n");
    const first = (await (await open(plan)).json()) as OpenReviewResponse;
    await open(brief, { visibility: "public" });
    expect(JSON.parse(readFileSync(join(reviewsDir, first.review_id, "review.json"), "utf8")).file).toBe(plan);

    await service!.stop();
    await start();
    const listed = (await (await fetch(`${service!.url}/api/review/v1/reviews`)).json()) as ListReviewsResponse;
    expect(listed.reviews.map((review) => [review.file, review.visibility, review.state, review.round])).toEqual([
      [brief, "public", "open", 1],
      [plan, "local", "open", 1],
    ]);
    expect(listed.reviews[1].link).toBe(`${service!.url}/plannotator/session/${first.review_id}/`);
    const reopened = (await (await open(plan)).json()) as OpenReviewResponse;
    expect(reopened.review_id).toBe(first.review_id);
    expect(await planOf(reopened.link)).toBe("# Plan\n");
  });

  test("lists one file's Review with its open Remarks", async () => {
    await start();
    const plan = document("plan.md", "# Plan\n");
    await open(plan);
    await open(document("brief.md", "# Brief\n"));

    const listed = (await (await fetch(`${service!.url}/api/review/v1/reviews?file=${encodeURIComponent(plan)}`)).json()) as ListReviewsResponse;
    expect(listed.reviews).toHaveLength(1);
    expect(listed.reviews[0]).toMatchObject({ file: plan, open_item_count: 0, open_items: [], listeners: [] });

    const none = (await (await fetch(`${service!.url}/api/review/v1/reviews?file=${encodeURIComponent(join(dir, "other.md"))}`)).json()) as ListReviewsResponse;
    expect(none.reviews).toEqual([]);
  });

  test("a Visibility change moves the link and is kept", async () => {
    await start();
    const { review_id } = (await (await open(document("plan.md", "# Plan\n"))).json()) as OpenReviewResponse;
    const answer = await fetch(`${service!.url}/api/review/v1/reviews/${review_id}/visibility`, {
      method: "POST",
      body: JSON.stringify({ visibility: "public" }),
    });
    expect(await answer.json()).toEqual({
      review_id,
      visibility: "public",
      link: `https://ctas.de-appspecialist.nl/plannotator/session/${review_id}/`,
    });
    expect(JSON.parse(readFileSync(join(reviewsDir, review_id, "review.json"), "utf8")).visibility).toBe("public");
  });

  test("answers health and the API version", async () => {
    await start();
    const health = await fetch(`${service!.url}/plannotator/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true, app: "plannotator", version: "test", api: { major: 1, minor: 3 } });
    expect(await (await fetch(`${service!.url}/api/review/version`)).json()).toEqual({ major: 1, minor: 3 });
  });

  test("names the LaunchAgent in health when launchd runs it", async () => {
    service = await startReviewService({ port: 0, reviewsDir, version: "test", startPage, log: () => {}, serviceLabel: "nl.de-appspecialist.plannotator" });
    const health = await (await fetch(`${service.url}/plannotator/health`)).json();
    expect(health.service).toEqual({ label: "nl.de-appspecialist.plannotator" });
  });

  test("refuses what the contract refuses and writes nothing", async () => {
    await start();
    expect((await open("relative/plan.md")).status).toBe(400);
    const missing = await open(join(dir, "missing.md"));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: `file not found: ${join(dir, "missing.md")}` });

    const foreign = await fetch(`${service!.url}/api/review/v1/reviews`, {
      method: "POST",
      headers: { origin: "https://evil.example" },
      body: JSON.stringify({ file: document("plan.md", "# Plan\n") }),
    });
    expect(foreign.status).toBe(403);

    const unknown = await fetch(`${service!.url}/plannotator/session/ffffffffffffffff/api/plan`);
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: "review not found" });

    const listed = (await (await fetch(`${service!.url}/api/review/v1/reviews`)).json()) as ListReviewsResponse;
    expect(listed.reviews).toEqual([]);
  });

  test("a page whose document is gone answers 502 and starts on a later request", async () => {
    let fail = true;
    service = await startReviewService({
      port: 0,
      reviewsDir,
      version: "test",
      log: () => {},
      startPage: async (review) => {
        if (fail) throw new Error("document gone");
        return startPage(review);
      },
    });
    const { link } = (await (await open(document("plan.md", "# Plan\n"))).json()) as OpenReviewResponse;
    const failed = await fetch(`${link}api/plan`);
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ error: "page failed to start: document gone" });

    fail = false;
    expect((await fetch(`${link}api/plan`)).status).toBe(200);
  });

  test("a Visibility change whose body arrives after a Cancel keeps the Cancel", async () => {
    await start();
    const { review_id } = (await (await open(document("plan.md", "# Plan\n"))).json()) as OpenReviewResponse;
    const body = JSON.stringify({ visibility: "public" });
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
      `POST /api/review/v1/reviews/${review_id}/visibility HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n`,
    );
    // The service exposes no signal for "headers routed, body awaited"; a real pause lets it
    // route the request over the socket before the Cancel, which is the race under test.
    await Bun.sleep(50);
    await fetch(`${service!.url}/api/review/v1/reviews/${review_id}/cancel`, { method: "POST" });
    socket.write(body);
    expect(await answered.promise).toContain('"visibility":"public"');
    socket.end();

    const stored = JSON.parse(readFileSync(join(reviewsDir, review_id, "review.json"), "utf8"));
    expect(stored).toMatchObject({ visibility: "public", state: "cancelled", round: 1 });
  });

  test("a page load whose HTML arrives after a Cancel keeps the Cancel", async () => {
    const requested = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const pageServer = Bun.serve({
      port: 0,
      fetch: () => {
        requested.resolve();
        const html = new ReadableStream<Uint8Array>({
          async start(controller) {
            controller.enqueue(new TextEncoder().encode("<html><head>"));
            await release.promise;
            controller.enqueue(new TextEncoder().encode("</head><body>page</body></html>"));
            controller.close();
          },
        });
        return new Response(html, { headers: { "content-type": "text/html" } });
      },
    });
    service = await startReviewService({
      port: 0,
      reviewsDir,
      version: "test",
      log: () => {},
      startPage: async () => ({ port: pageServer.port ?? 0, stop: () => pageServer.stop(true) }),
    });
    const { review_id, link } = (await (await open(document("plan.md", "# Plan\n"))).json()) as OpenReviewResponse;
    const loaded = fetch(link);
    await requested.promise;
    await fetch(`${service.url}/api/review/v1/reviews/${review_id}/cancel`, { method: "POST" });
    release.resolve();
    expect(await (await loaded).text()).toContain('<meta name="plannotator-review-round" content="1">');

    const stored = JSON.parse(readFileSync(join(reviewsDir, review_id, "review.json"), "utf8"));
    expect(stored).toMatchObject({ state: "cancelled", round: 1 });
    expect(stored.last_page_open).toEqual(expect.any(String));
  });
});

describe("service settings", () => {
  test("--port wins over the environment, which wins over 4397", () => {
    const env = { PLANNOTATOR_SERVICE_PORT: "5100", PLANNOTATOR_REVIEWS_DIR: "/tmp/reviews" };
    expect(resolveServiceSettings(["--port", "5200"], env)).toMatchObject({ ok: true, value: { port: 5200, reviewsDir: "/tmp/reviews" } });
    expect(resolveServiceSettings(["--port=0"], env)).toMatchObject({ ok: true, value: { port: 0, reviewsDir: "/tmp/reviews" } });
    expect(resolveServiceSettings([], env)).toMatchObject({ ok: true, value: { port: 5100, reviewsDir: "/tmp/reviews" } });
    // The default follows the data dir, which beforeEach points at PLANNOTATOR_DATA_DIR=<dir>/data.
    expect(resolveServiceSettings([], {})).toMatchObject({ ok: true, value: { port: 4397, reviewsDir: join(dir, "data", "reviews") } });
  });

  test("refuses a port that is not a whole number in range, and unknown arguments", () => {
    for (const args of [["--port", "70000"], ["--port", "12ab"], ["--port", "-1"], ["--port"], ["--verbose"]]) {
      expect(resolveServiceSettings(args, {}).ok).toBe(false);
    }
  });

  test("run by hand, serve opens no door; a door opens when its port is set and closes with off", () => {
    expect(resolveServiceSettings([], {})).toMatchObject({ ok: true, value: { publicDoor: null, temporaryPort: null } });
    expect(resolveServiceSettings([], { PLANNOTATOR_PUBLIC_PORT: "4399" })).toMatchObject({
      ok: true,
      value: { publicDoor: { host: "100.111.186.85", port: 4399, peer: "100.67.134.112" } },
    });
    const env = { PLANNOTATOR_PUBLIC_HOST: "127.0.0.1", PLANNOTATOR_PUBLIC_PORT: "4529", PLANNOTATOR_PUBLIC_PEER: "127.0.0.1", PLANNOTATOR_TEMPORARY_PORT: "4528" };
    expect(resolveServiceSettings([], env)).toMatchObject({
      ok: true,
      value: { publicDoor: { host: "127.0.0.1", port: 4529, peer: "127.0.0.1" }, temporaryPort: 4528 },
    });
    expect(resolveServiceSettings([], { PLANNOTATOR_PUBLIC_PORT: "off", PLANNOTATOR_TEMPORARY_PORT: "off" })).toMatchObject({
      ok: true,
      value: { publicDoor: null, temporaryPort: null },
    });
    expect(resolveServiceSettings([], { PLANNOTATOR_PUBLIC_PORT: "43a" }).ok).toBe(false);
    expect(resolveServiceSettings([], { PLANNOTATOR_TEMPORARY_PORT: "70000" }).ok).toBe(false);
  });

  test("temporary links use PLANNOTATOR_TEMPORARY_ORIGIN as a bare http(s) origin, else the fixed ngrok address", () => {
    expect(resolveServiceSettings([], {})).toMatchObject({ ok: true, value: { temporaryOrigin: "https://knowledgeably-supersweet-kizzie.ngrok-free.dev" } });
    expect(resolveServiceSettings([], { PLANNOTATOR_TEMPORARY_ORIGIN: "https://t.example/" })).toMatchObject({ ok: true, value: { temporaryOrigin: "https://t.example" } });
    for (const origin of ["t.example", "ftp://t.example", "https://t.example/path", "https://t.example?x=1"]) {
      expect([origin, resolveServiceSettings([], { PLANNOTATOR_TEMPORARY_ORIGIN: origin }).ok]).toEqual([origin, false]);
    }
  });

  test("PLANNOTATOR_MULTICA_PROFILE names the profile, trimmed; unset or blank leaves linking off", () => {
    expect(resolveServiceSettings([], { PLANNOTATOR_MULTICA_PROFILE: " skuddy " })).toMatchObject({ ok: true, value: { multicaProfile: "skuddy" } });
    expect(resolveServiceSettings([], { PLANNOTATOR_MULTICA_PROFILE: "  " })).toMatchObject({ ok: true, value: { multicaProfile: null } });
    expect(resolveServiceSettings([], {})).toMatchObject({ ok: true, value: { multicaProfile: null } });
  });
});
