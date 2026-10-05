import { expect, test } from "bun:test";
import { buildMulticaComment } from "./multica-poster.ts";
import type { StoredNotice, StoredRemark } from "./records.ts";

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
