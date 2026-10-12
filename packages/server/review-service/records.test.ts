import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MulticaIssue } from "@plannotator/shared/review-api";
import { ReviewRecords, openRemark, recordId, remarkEvent, remarksFromFeedback, type StoredNotice } from "./records.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

test("delivery survives reload, preserves posted destinations and enrolls only open reviewer events", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pn-records-")); dirs.push(dir);
  const id = "0123456789abcdef";
  const folder = (review: string) => join(dir, review);
  let issue: MulticaIssue | null = null;
  let records = await ReviewRecords.load([id], folder, () => {}, () => issue);
  const remarks = remarksFromFeedback({ annotations: [{ text: "answered" }, { text: "open" }] },
    { review_id: id, round: 1 }, "2026-10-05T00:00:00.000Z");
  await records.addRemarks(id, remarks);
  await records.addReply({ id: recordId("rp"), review_id: id, text: "done", answers: [remarks[0].id], at: remarks[0].at });
  const notice = (type: "finish" | "cancel"): StoredNotice => {
    const fields = { id: recordId("nt"), review_id: id, round: 1,
      at: "2026-10-05T00:00:01.000Z", status: "pending" } as const;
    return type === "finish" ? { type, ...fields, notes: "ship" } : { type, ...fields };
  };
  const finish = notice("finish"), cancel = notice("cancel"), acknowledged = notice("finish");
  await records.addNotice(finish); await records.addNotice(cancel); await records.addNotice(acknowledged);
  await records.acknowledge(acknowledged.id, finish.at);
  issue = { id: "WORK-1", workspace_id: "W" };
  await records.relink(id, issue, 1);
  expect(records.pendingDeliveries(id).map((r) => r.id)).toEqual([remarks[1].id, finish.id]);
  expect(remarks[0].multica).toBeUndefined(); expect(cancel.multica).toBeUndefined();
  expect(acknowledged.multica).toBeUndefined();
  const linked = remarksFromFeedback({ feedback: "linked" }, { review_id: id, round: 2 }, "2026-10-05T00:00:02.000Z");
  await records.addRemarks(id, linked);
  const linkedFinish = notice("finish"); await records.addNotice(linkedFinish);
  const linkedCancel = notice("cancel"); await records.addNotice(linkedCancel);
  expect(linked[0].multica).toEqual({ issue: "WORK-1", workspace_id: "W", status: "pending" });
  expect(linkedFinish.multica?.status).toBe("pending"); expect(linkedCancel.multica).toBeUndefined();
  await records.markPosted([remarks[1].id], "comment-1", finish.at);
  issue = { id: "WORK-2", workspace_id: "W2" }; await records.relink(id, issue, 2);
  await records.markPosted([finish.id], "comment-2", finish.at);
  records = await ReviewRecords.load([id], folder, () => {}, () => issue);
  expect(records.pendingDeliveries(id).map((r) => r.multica)).toEqual([
    { issue: "WORK-2", workspace_id: "W2", status: "pending" },
    { issue: "WORK-2", workspace_id: "W2", status: "pending" },
  ]);
  expect(records.backlog(id).some((r) => r.kind === "notice" && r.notice.id === finish.id)).toBe(false);
  expect(records.open(id).find((r) => r.id === remarks[1].id)?.multica).toEqual({
    issue: "WORK-1", workspace_id: "W", status: "posted", comment_id: "comment-1", posted_at: finish.at,
  });
  expect(records.page(id).remarks[1]).not.toHaveProperty("multica");
});

test("a link binds no Remark a listener received and no Finish of an earlier Round", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pn-records-")); dirs.push(dir);
  const id = "0123456789abcdef";
  const records = await ReviewRecords.load([id], (review) => join(dir, review), () => {}, () => null);
  const [received, unseen] = remarksFromFeedback({ annotations: [{ text: "received" }, { text: "unseen" }] },
    { review_id: id, round: 1 }, "2026-10-05T00:00:00.000Z");
  await records.addRemarks(id, [received, unseen]);
  await records.delivered(id, [received.id], "listener-session");
  const earlier: StoredNotice = { type: "finish", id: recordId("nt"), review_id: id, round: 1,
    at: "2026-10-05T00:00:01.000Z", status: "pending", notes: "" };
  await records.addNotice(earlier);
  await records.relink(id, { id: "WORK-1", workspace_id: "W" }, 2);
  expect(records.pendingDeliveries(id).map((r) => r.id)).toEqual([unseen.id]);
  expect(received.multica).toBeUndefined(); expect(earlier.multica).toBeUndefined();
  await records.relink(id, { id: "WORK-2", workspace_id: "W" }, 1);
  expect(records.pendingDeliveries(id).map((r) => r.id)).toEqual([unseen.id, earlier.id]);
});

test("one send shares a durable batch identity; separate sends and legacy records stay distinct", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pn-records-")); dirs.push(dir);
  const review = { review_id: "0123456789abcdef", round: 1 };
  const folder = (id: string) => join(dir, id);
  const at = "2026-10-12T00:00:00.000Z";
  const first = remarksFromFeedback({ annotations: [{ text: "one" }, { text: "two" }] }, review, at);
  const second = remarksFromFeedback({ feedback: "another send" }, review, at);
  expect(first[0].batch_id).toMatch(/^bt_[0-9a-f]{24}$/);
  expect(first[1].batch_id).toBe(first[0].batch_id);
  expect(second[0].batch_id).toMatch(/^bt_[0-9a-f]{24}$/);
  expect(second[0].batch_id).not.toBe(first[0].batch_id);
  const { batch_id: _batch, ...legacy } = second[0];
  const records = await ReviewRecords.load([review.review_id], folder, () => {});
  await records.addRemarks(review.review_id, [...first, ...second, { ...legacy, id: recordId("fi") }]);
  const reloaded = await ReviewRecords.load([review.review_id], folder, () => {});
  const kept = reloaded.open(review.review_id);
  expect(kept.map((item) => item.batch_id)).toEqual([first[0].batch_id, first[0].batch_id, second[0].batch_id, undefined]);
  expect(remarkEvent(kept[0]).batch_id).toBe(first[0].batch_id);
  expect(openRemark(kept[1]).batch_id).toBe(first[0].batch_id);
  expect(kept[3]).not.toHaveProperty("batch_id");
  expect(remarkEvent(kept[3])).not.toHaveProperty("batch_id");
  expect(openRemark(kept[3])).not.toHaveProperty("batch_id");
});
