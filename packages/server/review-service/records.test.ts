import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReviewRecords, openRemark, recordId, remarkEvent, remarksFromFeedback, type StoredNotice } from "./records.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

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
