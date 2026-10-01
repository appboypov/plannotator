import { describe, expect, test } from "bun:test";
import { loadPageReplies, parsePageReplies } from "./page-replies.ts";

const BASE = "/plannotator/session/0123456789abcdef/";
const REVIEW = "0123456789abcdef";

const reply = { id: "rp_1", review_id: REVIEW, text: "Done.", answers: ["fi_1"], at: "2026-10-01T09:40:00.000Z" };
const remark = {
  id: "fi_1",
  review_id: REVIEW,
  round: 1,
  text: "Tighten this.",
  anchor: { selector: "block-2", tag: "comment", text: "The heading" },
  at: "2026-10-01T09:30:00.000Z",
  status: "answered",
  replies: [reply],
};

describe("parsePageReplies", () => {
  test("keeps well-formed Remarks and Replies and drops malformed ones", () => {
    const parsed = parsePageReplies({
      review_id: REVIEW,
      remarks: [remark, { ...remark, id: "fi_2", status: "lost" }, { ...remark, id: "fi_3", replies: [reply, { ...reply, answers: [1] }] }],
      replies: [{ ...reply, id: "rp_2", answers: [] }, { id: "rp_3" }],
    });
    expect(parsed?.remarks.map((entry) => entry.id)).toEqual(["fi_1", "fi_3"]);
    expect(parsed?.remarks[1].replies).toEqual([reply]);
    expect(parsed?.replies.map((entry) => entry.id)).toEqual(["rp_2"]);
  });

  test("an answer without a Review or both lists is not a page's Remarks", () => {
    expect(parsePageReplies({ remarks: [], replies: [] })).toBeUndefined();
    expect(parsePageReplies({ review_id: REVIEW, remarks: [] })).toBeUndefined();
    expect(parsePageReplies([])).toBeUndefined();
  });
});

describe("loadPageReplies", () => {
  test("reads the page's own Review under its base path", async () => {
    const asked: string[] = [];
    const loaded = await loadPageReplies(async (input) => {
      asked.push(input);
      return Response.json({ review_id: REVIEW, remarks: [remark], replies: [] });
    }, `${BASE}`);
    expect(asked).toEqual([`${BASE}api/review-replies`]);
    expect(loaded?.remarks[0].replies[0].text).toBe("Done.");
  });

  test("a page outside a session path asks nothing", async () => {
    let asked = false;
    expect(await loadPageReplies(async () => ((asked = true), Response.json({})), "/")).toBeNull();
    expect(asked).toBe(false);
  });

  test("a refused or shapeless answer throws", async () => {
    await expect(loadPageReplies(async () => Response.json({ error: "review not found" }, { status: 404 }), BASE)).rejects.toThrow("HTTP 404");
    await expect(loadPageReplies(async () => Response.json({ error: "x" }), BASE)).rejects.toThrow("no Remarks");
  });
});
