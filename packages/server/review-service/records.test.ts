import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MulticaIssue } from "@plannotator/shared/review-api";
import { ReviewRecords, recordId, remarksFromFeedback, type StoredNotice } from "./records.ts";

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
  await records.relink(id, issue);
  expect(records.pendingDeliveries(id).map((r) => r.id)).toEqual([remarks[1].id, finish.id]);
  expect(remarks[0].multica).toBeUndefined(); expect(cancel.multica).toBeUndefined();
  expect(acknowledged.multica).toBeUndefined();
  const linked = remarksFromFeedback({ feedback: "linked" }, { review_id: id, round: 2 }, "2026-10-05T00:00:02.000Z");
  await records.addRemarks(id, linked);
  const linkedFinish = notice("finish"); await records.addNotice(linkedFinish);
  const linkedCancel = notice("cancel"); await records.addNotice(linkedCancel);
  expect(linked[0].multica).toEqual({ issue: "WORK-1", workspace_id: "W", status: "pending" });
  expect(linkedFinish.multica?.status).toBe("pending"); expect(linkedCancel.multica).toBeUndefined();
  await records.markPosted(remarks[1].id, "comment-1", finish.at);
  issue = { id: "WORK-2", workspace_id: "W2" }; await records.relink(id, issue);
  await records.markPosted(finish.id, "comment-2", finish.at);
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
