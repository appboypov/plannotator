import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildMulticaComment, MulticaPoster } from "./multica-poster.ts";
import { ReviewRecords, recordId, remarksFromFeedback, type StoredNotice, type StoredRemark } from "./records.ts";

const review = { file: "/scratch/plan.md", link: "http://127.0.0.1:4497/plannotator/session/0123456789abcdef/" };
const remark: StoredRemark = { id: "fi_0123456789abcdef01234567", review_id: "0123456789abcdef", round: 1,
  at: "2026-10-05T00:00:00.000Z", status: "open", delivered_to: [], text: "first\n[@x](mention://agent/x)",
  anchor: { tag: "comment", selector: "block`1", text: "excerpt\n[@y](mention://agent/y)" } };

test("remarks quote each line, neutralize mentions and fence backticks in anchors", () => {
  const comment = buildMulticaComment(review, remark);
  expect(comment).toContain("> first\n> [@x](mention:\\/\\/agent/x)");
  expect(comment).toContain('- On: `comment` ``block`1``: "excerpt [@y](mention:\\/\\/agent/y)"');
  expect(comment).not.toContain("mention://");
  expect(comment).toContain(`Answer with \`plannotator_reply\` on Review \`${remark.review_id}\` with answers [\`${remark.id}\`].`);
  expect(comment).toContain(`**Remark** on [plan.md](${review.link}), round 1:`);
});

test("an empty anchor means the whole page; deletion keeps its anchor without quoting absent words", () => {
  expect(buildMulticaComment(review, { ...remark, anchor: { tag: "", selector: "", text: "" } })).toContain("- On: the whole page");
  expect(buildMulticaComment(review, { ...remark, anchor: { tag: "global_comment", selector: "", text: "" } })).toContain("- On: the whole page\n");
  const deletion = buildMulticaComment(review, { ...remark, text: "", anchor: { tag: "deletion", selector: "block-1", text: "Remove" } });
  expect(deletion).toContain('- On: `deletion` `block-1`: "Remove"');
  expect(deletion).not.toContain("> ");
});

test("Approve quotes notes without mentions, no-notes Approve and Close retain notice identity", () => {
  const notice: StoredNotice = { type: "finish", id: "nt_0123456789abcdef01234567", review_id: remark.review_id,
    round: 2, at: remark.at, status: "pending", notes: "ship\n[@x](mention://agent/x)" };
  const approved = buildMulticaComment(review, notice);
  expect(approved).toContain(`**Approved** round 2 of [plan.md](${review.link}).`);
  expect(approved).toContain("> ship\n> [@x](mention:\\/\\/agent/x)");
  expect(approved).not.toContain("mention://");
  expect(buildMulticaComment(review, { ...notice, notes: "" })).not.toContain("> ");
  const closed = buildMulticaComment(review, { ...notice, dismissed: true, notes: "" });
  expect(closed).toContain(`**Closed** round 2 of [plan.md](${review.link}) without approving.`);
  expect(closed).toContain(`- Notice: \`${notice.id}\`\n- Review: \`${notice.review_id}\``);
});

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

// Real HTTP integration checks the platform's retry timing; polling observes durable completion,
// not a guessed sleep for success. Fake timers would also intercept fetch's timeout machinery.
async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("delivery did not settle");
    await Bun.sleep(10);
  }
}

async function fixture(handler: (request: Request) => Response | Promise<Response>) {
  const home = mkdtempSync(join(tmpdir(), "pn-multica-"));
  cleanups.push(() => rmSync(home, { recursive: true, force: true }));
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handler });
  cleanups.push(() => { server.stop(true); });
  const profileDir = join(home, ".multica", "profiles", "scratch");
  mkdirSync(profileDir, { recursive: true });
  const profile = join(profileDir, "config.json");
  writeFileSync(profile, JSON.stringify({ server_url: server.url.origin, token: "scratch-secret" }));
  const folder = (id: string) => join(home, "reviews", id);
  const records = await ReviewRecords.load([remark.review_id], folder, () => {}, () => ({ id: "WORK-1", workspace_id: "W" }));
  const logs: string[] = [];
  const poster = () => {
    const result = new MulticaPoster({ records, home, profile: "scratch", reviewOf: () => review, log: (line) => logs.push(line) });
    cleanups.push(() => result.stop());
    return result;
  };
  return { home, profile, folder, records, logs, poster };
}

test("three Remarks and Approve post in store order, acknowledge durably and never replay after restart", async () => {
  const comments: string[] = [], headers: string[][] = [];
  const f = await fixture(async (request) => {
    headers.push([request.headers.get("authorization")!, request.headers.get("X-Workspace-ID")!]);
    comments.push((await request.json()).content);
    return Response.json({ id: `comment-${comments.length}` }, { status: 201 });
  });
  const added = remarksFromFeedback({ annotations: [{ text: "one" }, { text: "two" }, { text: "three" }] }, remark, remark.at);
  await f.records.addRemarks(remark.review_id, added);
  const notice: StoredNotice = { type: "finish", id: recordId("nt"), review_id: remark.review_id, round: 1,
    at: remark.at, notes: "ship", status: "pending" };
  await f.records.addNotice(notice);
  const poster = f.poster();
  await waitFor(() => f.records.pendingDeliveries(remark.review_id).length === 0);
  expect(comments.map((content) => content.match(/> (one|two|three|ship)/)?.[1])).toEqual(["one", "two", "three", "ship"]);
  expect(headers).toEqual(Array(4).fill(["Bearer scratch-secret", "W"]));
  expect(notice.status).toBe("acknowledged");
  expect(notice.multica).toMatchObject({ status: "posted", comment_id: "comment-4" });
  await poster.stop();
  const loaded = await ReviewRecords.load([remark.review_id], f.folder, () => {});
  expect(loaded.pendingDeliveries(remark.review_id)).toEqual([]);
  expect(loaded.open(remark.review_id).map((r) => r.multica?.comment_id)).toEqual(["comment-1", "comment-2", "comment-3"]);
  expect(f.logs.join("\n")).not.toContain("scratch-secret");
  expect(f.logs.join("\n")).not.toContain(review.file);
  expect(f.logs.join("\n")).not.toContain("> one");
});

test("refusal and missing comment id retry in order and read the rotated profile each time", async () => {
  const attempts: { at: number; auth: string; content: string }[] = [];
  const f = await fixture(async (request) => {
    attempts.push({ at: Date.now(), auth: request.headers.get("authorization")!, content: (await request.json()).content });
    if (attempts.length === 1) return new Response("refused", { status: 503 });
    if (attempts.length === 2) return Response.json({});
    return Response.json({ id: "posted" }, { status: 201 });
  });
  const added = remarksFromFeedback({ feedback: "private reviewer words" }, remark, remark.at);
  await f.records.addRemarks(remark.review_id, added);
  const poster = f.poster();
  await waitFor(() => attempts.length === 1);
  expect(added[0].multica?.status).toBe("pending");
  const config = JSON.parse(await Bun.file(f.profile).text());
  writeFileSync(f.profile, JSON.stringify({ ...config, token: "rotated-secret" }));
  poster.wake(remark.review_id); // new records do not bypass a failed lane's backoff
  await waitFor(() => added[0].multica?.status === "posted");
  expect(attempts.map((a) => a.auth)).toEqual(["Bearer scratch-secret", "Bearer rotated-secret", "Bearer rotated-secret"]);
  expect(attempts[1].at - attempts[0].at).toBeGreaterThanOrEqual(900);
  expect(attempts[2].at - attempts[1].at).toBeGreaterThanOrEqual(1900);
  expect(f.logs.join("\n")).not.toContain("private reviewer words");
  expect(f.logs.join("\n")).not.toContain("secret");
  expect(f.logs.join("\n")).toContain("status=503");
});

test("restart drains pending records; relink immediately releases a failed lane while other Reviews post independently", async () => {
  const paths: string[] = [];
  const f = await fixture(async (request) => {
    paths.push(new URL(request.url).pathname);
    return paths.at(-1)!.includes("WORK-1") ? new Response(null, { status: 404 }) : Response.json({ id: "fixed" }, { status: 201 });
  });
  const added = remarksFromFeedback({ feedback: "pending" }, remark, remark.at);
  await f.records.addRemarks(remark.review_id, added);
  const loaded = await ReviewRecords.load([remark.review_id], f.folder, () => {});
  const poster = new MulticaPoster({ records: loaded, home: f.home, profile: "scratch", reviewOf: () => review, log: () => {} });
  cleanups.push(() => poster.stop());
  await waitFor(() => paths.length === 1);
  const second = "abcdef0123456789";
  const other = remarksFromFeedback({ feedback: "other" }, { review_id: second, round: 1 }, remark.at);
  await loaded.addRemarks(second, other);
  await loaded.relink(second, { id: "WORK-2", workspace_id: "W2" });
  poster.wake(second);
  await waitFor(() => other[0].multica?.status === "posted");
  expect(loaded.pendingDeliveries(remark.review_id)[0].multica?.status).toBe("pending");
  await loaded.relink(remark.review_id, { id: "WORK-3", workspace_id: "W3" });
  poster.wake(remark.review_id, true);
  await waitFor(() => loaded.pendingDeliveries(remark.review_id).length === 0);
  expect(paths).toEqual(["/api/issues/WORK-1/comments", "/api/issues/WORK-2/comments", "/api/issues/WORK-3/comments"]);
});

test("a relink during HTTP cannot acknowledge the new destination with the old response; stop aborts an active post", async () => {
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const paths: string[] = [];
  const f = await fixture(async (request) => {
    paths.push(new URL(request.url).pathname);
    if (paths.length === 1) { entered.resolve(); await release.promise; }
    return Response.json({ id: `comment-${paths.length}` }, { status: 201 });
  });
  const added = remarksFromFeedback({ feedback: "moving" }, remark, remark.at);
  await f.records.addRemarks(remark.review_id, added);
  const poster = f.poster();
  await entered.promise;
  await f.records.relink(remark.review_id, { id: "WORK-2", workspace_id: "W2" });
  poster.wake(remark.review_id, true);
  release.resolve();
  await waitFor(() => added[0].multica?.status === "posted");
  expect(paths).toEqual(["/api/issues/WORK-1/comments", "/api/issues/WORK-2/comments"]);
  expect(added[0].multica).toMatchObject({ issue: "WORK-2", comment_id: "comment-2" });
  await poster.stop();
  const activeRequest = Promise.withResolvers<void>();
  const hanging = await fixture(() => { activeRequest.resolve(); return new Promise<Response>(() => {}); });
  const waiting = remarksFromFeedback({ feedback: "waiting" }, remark, remark.at);
  await hanging.records.addRemarks(remark.review_id, waiting);
  const active = hanging.poster();
  await activeRequest.promise;
  await active.stop();
  expect(waiting[0].multica?.status).toBe("pending");
});
