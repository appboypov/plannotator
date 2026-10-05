import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startReviewService, type ReviewService } from "./service";
import { reviewIdForFile } from "./store";
import { remarksFromFeedback } from "./records";
import { matchDoorRequest } from "./door-manifest";
import { reviewThroughService, reviewsThroughService } from "../../../apps/hook/server/review-service-client";
import type { OpenReviewResponse } from "@plannotator/shared/review-api";
import { getReviewDeniedSuffix } from "@plannotator/shared/prompts";

const PR = "https://github.com/owner/repo/pull/22";
let dir: string;
let service: ReviewService;
let starts: number;
let cleared: string[];
let failStart: boolean;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pn-pr-reviews-"));
  starts = 0;
  cleared = [];
  failStart = false;
  service = await startReviewService({
    port: 0, reviewsDir: dir, version: "test", log: () => {},
    publicDoor: { host: "127.0.0.1", port: 0, peer: "127.0.0.1" },
    startPage: async (review) => {
      starts++;
      if (failStart) { failStart = false; throw new Error("auth unavailable"); }
      const page = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
        const url = new URL(request.url);
        if (request.method === "DELETE") cleared.push(url.pathname + url.search);
        if (url.pathname === "/") return new Response("<html><head></head><body>Code review</body></html>", { headers: { "content-type": "text/html" } });
        return Response.json({ rawPatch: `diff for ${review.file}`, platformUser: "reviewer-login", agentCwd: "/private/checkout", repoInfo: {}, gitContext: { cwd: "/private/checkout" }, serverConfig: { gitUser: "private", theme: "dark" } });
      } });
      return { port: page.port!, stop: () => page.stop(true) };
    },
  });
  await Promise.all(service.doors.map((door) => door.bound));
});

afterEach(async () => { await service.stop(); await rm(dir, { recursive: true, force: true }); });

async function post(url: string, body?: unknown) {
  return fetch(url, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
}
async function open(file = PR, extra = {}): Promise<OpenReviewResponse> {
  const answer = await post(`${service.url}/api/review/v1/reviews`, { file, ...extra });
  expect(answer.status).toBe(200);
  return answer.json();
}
async function listen(review: OpenReviewResponse) {
  const frames: Record<string, unknown>[] = [];
  const subscribed = Promise.withResolvers<void>();
  const finishes = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
  let finishCount = 0;
  const socket = new WebSocket(`${service.url.replace("http:", "ws:")}/api/review/v1/listen?session=test`);
  socket.onopen = () => socket.send(JSON.stringify({ type: "subscribe", reviews: [review.review_id] }));
  socket.onmessage = (event) => {
    const value: unknown = JSON.parse(String(event.data));
    if (!value || typeof value !== "object") throw new Error("invalid frame");
    const frame = Object.fromEntries(Object.entries(value));
    frames.push(frame);
    if (frame.type === "subscribed") subscribed.resolve();
    if (frame.type === "finish") finishes[finishCount++]?.resolve();
  };
  await subscribed.promise;
  return { frames, socket, finishes };
}

test("GitLab and Bitbucket URL suffixes use their provider number and canonical subject", async () => {
  for (const [url, canonical] of [
    ["https://gitlab.example.com/group/sub/project/-/merge_requests/42/diffs", "https://gitlab.example.com/group/sub/project/-/merge_requests/42"],
    ["https://bitbucket.org/workspace/repo/pull-requests/7/diff", "https://bitbucket.org/workspace/repo/pull-requests/7"],
  ]) {
    const review = await open(url);
    const listed = await (await fetch(`${service.url}/api/review/v1/reviews?file=${encodeURIComponent(url!)}`)).json();
    expect(listed.reviews[0]).toMatchObject({ review_id: review.review_id, file: canonical });
  }
});

test("open and filtered list canonicalize PR URLs without starting a page and survive restart", async () => {
  const first = await open(`${PR}/files`);
  expect(await open(`${PR}/`)).toEqual(first);
  expect(await open("https://github.com/OWNER/Repo/pull/22")).toEqual(first);
  const listed = await (await fetch(`${service.url}/api/review/v1/reviews?file=${encodeURIComponent(PR + "/files/")}`)).json();
  expect(listed.reviews[0]).toMatchObject({ review_id: first.review_id, file: PR, open_items: [] });
  expect(starts).toBe(0);
  await service.stop();
  service = await startReviewService({ port: 0, reviewsDir: dir, version: "test", log: () => {}, startPage: async () => { throw new Error("not requested"); } });
  expect((await (await fetch(`${service.url}/api/review/v1/reviews`)).json()).reviews[0].file).toBe(PR);
  expect((await open(PR)).review_id).toBe(first.review_id);
  for (const url of ["https://example.com/not-a-pr", "http://example.com/no"]) {
    const bad = await post(`${service.url}/api/review/v1/reviews`, { file: url });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toContain(url);
    expect((await fetch(`${service.url}/api/review/v1/reviews?file=${encodeURIComponent(url)}`)).status).toBe(400);
  }
});

test("code annotation mapping preserves ranges, file scope, excerpt precedence and suggestion", () => {
  const rows = remarksFromFeedback({ feedback: "whole feedback", annotations: [
    { filePath: "src/a.ts", lineStart: 3, lineEnd: 5, type: "COMMENT", text: "Check this", originalCode: "old", selectedText: "selected" },
    { filePath: "src/b.ts", lineStart: 8, lineEnd: 8, type: "SUGGESTION", text: "Use this", suggestedCode: "const b = 2;", selectedText: "b" },
    { filePath: "src/c.ts", scope: "file", lineStart: 1, lineEnd: 4, type: "COMMENT", text: "File note", tokenText: "c" },
  ] }, { review_id: "0123456789abcdef", round: 2 }, "2026-10-05T10:00:00.000Z");
  expect(rows.map((row) => row.anchor)).toEqual([
    { selector: "src/a.ts:3-5", tag: "comment", text: "old" },
    { selector: "src/b.ts:8", tag: "suggestion", text: "b" },
    { selector: "src/c.ts", tag: "comment", text: "c" },
  ]);
  expect(rows[1]!.text).toBe("Use this\n\n```\nconst b = 2;\n```");
  expect(rows.every((row) => row.feedback === "whole feedback" && row.round === 2)).toBe(true);
});

test("an empty code suggestion preserves the removal as a fenced block", () => {
  const [remark] = remarksFromFeedback({ annotations: [
    { filePath: "a.ts", lineStart: 1, type: "SUGGESTION", text: "Remove this", suggestedCode: "", originalCode: "obsolete()" },
  ] }, { review_id: "0123456789abcdef", round: 1 }, "2026-10-05T10:00:00.000Z");
  expect(remark!.text).toBe("Remove this\n\n```\n\n```");
  expect(remark!.anchor).toEqual({ selector: "a.ts:1", tag: "suggestion", text: "obsolete()" });
});

test("general code annotations map to global Remarks without a line selector", () => {
  const remarks = remarksFromFeedback({ feedback: "Whole review", annotations: [
    { filePath: "src/a.ts", lineStart: 4, scope: "general", type: "COMMENT", text: "Review-wide note" },
    { filePath: "", lineStart: 0, type: "COMMENT", text: "Unanchored note" },
  ] }, { review_id: "0123456789abcdef", round: 1 }, "2026-10-05T10:00:00.000Z");
  expect(remarks.map(({ text, anchor, feedback }) => ({ text, anchor, feedback }))).toEqual([
    { text: "Review-wide note", anchor: { selector: "", tag: "global_comment", text: "" }, feedback: "Whole review" },
    { text: "Unanchored note", anchor: { selector: "", tag: "global_comment", text: "" }, feedback: "Whole review" },
  ]);
});

test("PR feedback emits Remarks; Approve and Close emit Finish, refuse ended and stale Rounds, and clear drafts", async () => {
  const review = await open();
  const { socket, frames, finishes } = await listen(review);
  try {
    expect((await post(`${review.link}api/feedback`, { round: 1, draftGeneration: 7, feedback: "Review", annotations: [{ filePath: "a.ts", lineStart: 2, lineEnd: 2, type: "COMMENT", text: "Fix", originalCode: "bad()" }] })).status).toBe(200);
    expect((await post(`${review.link}api/feedback`, { round: 1, feedback: "General" })).status).toBe(200);
    expect((await post(`${review.link}api/feedback`, { round: 1, approved: true, feedback: "Ship" })).status).toBe(200);
    await finishes[0]!.promise;
    expect(frames.filter((f) => f.type === "feedback_item").map((f) => [f.text, f.anchor])).toEqual([
      ["Fix", { selector: "a.ts:2", tag: "comment", text: "bad()" }],
      ["General", { selector: "", tag: "global_comment", text: "" }],
    ]);
    expect(frames.find((f) => f.type === "finish")).toMatchObject({ round: 1, notes: "Ship" });
    expect(cleared[0]).toBe("/api/draft?generation=7");
    expect((await post(`${review.link}api/feedback`, { round: 1, feedback: "late" })).status).toBe(409);
    const reopened = await open(PR, { reopen: true, visibility: "public" });
    expect(reopened.round).toBe(2);
    expect((await post(`${review.link}api/feedback`, { round: 1, feedback: "stale" })).status).toBe(409);
    const doorLink = `http://127.0.0.1:${service.doors[0]!.port()}/plannotator/session/${review.review_id}/`;
    expect((await post(`${doorLink}api/exit?draftGeneration=8&round=2`)).status).toBe(200);
    await finishes[1]!.promise;
    expect(frames.filter((f) => f.type === "finish")[1]).toMatchObject({ round: 2, dismissed: true, notes: "" });
    expect(starts).toBe(2);
    expect(cleared.at(-1)).toBe("/api/draft?generation=8");
  } finally { socket.close(); }
});

test("document Close through a door clears the page's draft generation and emits dismissed Finish", async () => {
  const file = join(dir, "plan.md");
  await writeFile(file, "# Plan");
  const review = await open(file, { visibility: "public" });
  const { socket, frames, finishes } = await listen(review);
  try {
    const doorLink = `http://127.0.0.1:${service.doors[0]!.port()}/plannotator/session/${review.review_id}/`;
    expect((await post(`${doorLink}api/exit?draftGeneration=11&round=1`)).status).toBe(200);
    await finishes[0]!.promise;
    expect(frames.find((frame) => frame.type === "finish")).toMatchObject({ review_id: review.review_id, round: 1, dismissed: true, notes: "" });
    expect(cleared).toEqual(["/api/draft?generation=11"]);
    expect((await post(`${doorLink}api/exit?draftGeneration=11&round=1`)).status).toBe(409);
    expect(cleared).toEqual(["/api/draft?generation=11"]);
  } finally { socket.close(); }
});

test("failed PR page startup retries the next request", async () => {
  const review = await open(); failStart = true;
  expect((await fetch(review.link)).status).toBe(502);
  expect((await fetch(review.link)).status).toBe(200);
  expect(starts).toBe(2);
});

test("PR door reads strip local paths, refuse external writes and stop at visibility change", async () => {
  const review = await open(PR, { visibility: "public" });
  const link = `http://127.0.0.1:${service.doors[0]!.port()}/plannotator/session/${review.review_id}/`;
  for (const route of ["api/diff", "api/diff/fresh?snapshot=x"]) {
    const diff = await (await fetch(`${link}${route}`)).json();
    expect(diff.rawPatch).toContain(PR);
    expect(diff.platformUser).toBeUndefined();
    expect(diff.serverConfig).toEqual({ theme: "dark" });
    expect(JSON.stringify(diff)).not.toContain("private");
  }
  for (const route of ["pr-action", "pr-viewed", "git-add", "open-in", "agents", "config", "upload", "code-nav/resolve", "pr-switch"]) {
    expect((await post(`${link}api/${route}`, {})).status).toBe(404);
  }
  await post(`${service.url}/api/review/v1/reviews/${review.review_id}/visibility`, { visibility: "local" });
  expect((await fetch(`${link}api/diff`)).status).toBe(404);
  const file = join(dir, "plan.md"); await writeFile(file, "Plan");
  const plan = await open(file, { visibility: "public" });
  expect((await fetch(`http://127.0.0.1:${service.doors[0]!.port()}/plannotator/session/${plan.review_id}/api/file-content?path=a.ts`)).status).toBe(404);
});

test("a door refuses a PR Review under the id worked out from its URL", async () => {
  const review = await open(PR, { visibility: "public" });
  const computed = reviewIdForFile(PR);
  expect(review.review_id).not.toBe(computed);
  const sessions = `http://127.0.0.1:${service.doors[0]!.port()}/plannotator/session/`;
  for (const route of ["", "api/diff", "api/pr-context"]) expect((await fetch(`${sessions}${computed}/${route}`)).status).toBe(404);
  for (const route of ["api/feedback", "api/approve", "api/exit?round=1"]) {
    expect((await post(`${sessions}${computed}/${route}`, { approved: true, feedback: "lgtm (not Brian)" })).status).toBe(404);
  }
  const listed = await (await fetch(`${service.url}/api/review/v1/reviews?file=${encodeURIComponent(PR)}`)).json();
  expect(listed.reviews[0]).toMatchObject({ review_id: review.review_id, state: "open", open_items: [] });
  expect((await fetch(`${sessions}${review.review_id}/api/diff`)).status).toBe(200);
});

test("door manifest allows only PR read queries and Review commands", () => {
  const base = "https://ctas.de-appspecialist.nl/plannotator/session/0123456789abcdef/";
  for (const route of ["api/diff", "api/diff/fresh?snapshot=x", "api/pr-context", "api/pr-context/stream", "api/file-content?path=a.ts&oldPath=b.ts&snapshot=x", "api/review-image?path=a.png&side=new&snapshot=x"]) {
    expect(matchDoorRequest("GET", new URL(base + route))).not.toBeNull();
  }
  expect(matchDoorRequest("GET", new URL(base + "api/file-content?path=a.ts&base=main"))).toBeNull();
  expect(matchDoorRequest("POST", new URL(base + "api/pr-action"))).toBeNull();
  expect(matchDoorRequest("DELETE", new URL(base + "api/draft?generation=3"))).not.toBeNull();
});

test("plain PR CLI selection leaves every mode flag and local target upstream", () => {
  expect(reviewsThroughService([PR, "--json"])).toBe(true);
  expect(reviewsThroughService([PR + "/files"])).toBe(true);
  for (const args of [[PR, "--local"], [PR, "--no-local"], [PR, "--tailscale"], [PR, "--base", "main"], ["."]]) expect(reviewsThroughService(args)).toBe(false);
});

for (const decision of ["approve", "feedback", "close"] as const) test(`PR CLI takes ${decision} through shared transport`, async () => {
  const opened = Promise.withResolvers<OpenReviewResponse>();
  const result = reviewThroughService({ file: PR, port: service.port, onOpened: opened.resolve, reconnect: { attempts: 0, delayMs: 0 } });
  const review = await opened.promise;
  if (decision === "close") await post(`${review.link}api/exit?round=1`);
  else await post(`${review.link}api/feedback`, { round: 1, approved: decision === "approve", feedback: decision === "approve" ? "Ship with notes" : "Fix the code", annotations: decision === "feedback" ? [{ filePath: "a.ts", lineStart: 1, type: "COMMENT", text: "Fix" }] : [] });
  const ended = await result;
  expect(ended.ok).toBe(true);
  if (!ended.ok) throw new Error(ended.error);
  expect(ended.output.decision).toBe(decision === "approve" ? "approved" : decision === "close" ? "dismissed" : "annotated");
  if (decision !== "close") expect(ended.output.message).toContain(decision === "approve" ? "Ship with notes" : "Fix the code");
  if (decision === "feedback") {
    const listed = await (await fetch(`${service.url}/api/review/v1/reviews?file=${encodeURIComponent(PR)}`)).json();
    expect(listed.reviews[0]).toMatchObject({ state: "cancelled", open_item_count: 0 });
  }
});

test("PR CLI feedback with only a review-wide code comment asks to address it", async () => {
  const opened = Promise.withResolvers<OpenReviewResponse>();
  const result = reviewThroughService({ file: PR, port: service.port, onOpened: opened.resolve, reconnect: { attempts: 0, delayMs: 0 } });
  const review = await opened.promise;
  await post(`${review.link}api/feedback`, { round: 1, approved: false, feedback: "Overall: split this PR", annotations: [{ filePath: "", scope: "general", type: "COMMENT", text: "Split this PR" }] });
  const ended = await result;
  if (!ended.ok) throw new Error(ended.error);
  expect(ended.output).toEqual({ decision: "annotated", message: `Overall: split this PR\n${getReviewDeniedSuffix(undefined)}` });
});
