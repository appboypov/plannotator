import { describe, expect, test } from "bun:test";
import {
  ERRORS,
  isLocalRequest,
  parseListenClientMessage,
  parseListReviewsQuery,
  parseOpenReviewRequest,
  parseReplyRequest,
  parseVisibilityRequest,
} from "./parse.ts";
import { reviewLink } from "./routes.ts";

describe("open request", () => {
  test("accepts a temporary Visibility and a reopen", () => {
    expect(parseOpenReviewRequest({ file: "/tmp/plan.md", reopen: true, visibility: "temporary" })).toEqual({
      ok: true,
      value: { file: "/tmp/plan.md", reopen: true, visibility: "temporary" },
    });
  });

  test("leaves Visibility out when none is named, so an existing Review keeps its own", () => {
    expect(parseOpenReviewRequest({ file: "/tmp/plan.md" })).toEqual({ ok: true, value: { file: "/tmp/plan.md" } });
  });

  test("trims a complete issue and refuses incomplete, blank and non-object links", () => {
    expect(parseOpenReviewRequest({ file: "/tmp/plan.md", issue: { id: " WORK-1 ", workspace_id: " W " } })).toEqual({
      ok: true, value: { file: "/tmp/plan.md", issue: { id: "WORK-1", workspace_id: "W" } },
    });
    for (const issue of [null, "WORK-1", {}, { id: "WORK-1" }, { id: " ", workspace_id: "W" },
      { id: "WORK-1", workspace_id: " " }, { id: 1, workspace_id: "W" }]) {
      expect(parseOpenReviewRequest({ file: "/tmp/plan.md", issue }).ok).toBe(false);
    }
  });

  test("refuses a missing, blank or relative file", () => {
    expect(parseOpenReviewRequest({})).toEqual({ ok: false, error: ERRORS.fileRequired });
    expect(parseOpenReviewRequest({ file: "  " })).toEqual({ ok: false, error: ERRORS.fileRequired });
    expect(parseOpenReviewRequest({ file: "plan.md" })).toEqual({ ok: false, error: ERRORS.fileNotAbsolute });
  });

  test("refuses a Visibility outside the three", () => {
    expect(parseOpenReviewRequest({ file: "/tmp/plan.md", visibility: "private" })).toEqual({
      ok: false,
      error: ERRORS.visibility,
    });
    expect(parseVisibilityRequest({})).toEqual({ ok: false, error: ERRORS.visibility });
  });
});

describe("reply request", () => {
  test("counts a duplicate answer once, in the order named", () => {
    expect(parseReplyRequest({ text: "Done.", answers: ["fi_b", "fi_a", "fi_b"] })).toEqual({
      ok: true,
      value: { text: "Done.", answers: ["fi_b", "fi_a"] },
    });
  });

  test("answers nothing when answers is absent", () => {
    expect(parseReplyRequest({ text: "Noted." })).toEqual({ ok: true, value: { text: "Noted.", answers: [] } });
  });

  test("refuses blank text and answers that are not ids", () => {
    expect(parseReplyRequest({ text: " \n" })).toEqual({ ok: false, error: ERRORS.replyText });
    expect(parseReplyRequest({ text: "ok", answers: "fi_a" })).toEqual({ ok: false, error: ERRORS.answers });
    expect(parseReplyRequest({ text: "ok", answers: [1] })).toEqual({ ok: false, error: ERRORS.answers });
    expect(parseReplyRequest({ text: "ok", answers: null })).toEqual({ ok: false, error: ERRORS.answers });
  });
});

describe("list query", () => {
  test("lists all Reviews without a file and refuses a relative one", () => {
    expect(parseListReviewsQuery(null)).toEqual({ ok: true, value: {} });
    expect(parseListReviewsQuery("docs/plan.md")).toEqual({ ok: false, error: ERRORS.fileNotAbsolute });
  });
});

describe("listen client message", () => {
  test("a subscription counts a duplicate Review once", () => {
    expect(parseListenClientMessage('{"type":"subscribe","reviews":["a","b","a"]}')).toEqual({
      ok: true,
      value: { type: "subscribe", reviews: ["a", "b"] },
    });
    expect(parseListenClientMessage('{"type":"subscribe","reviews":"all"}')).toEqual({
      ok: true,
      value: { type: "subscribe", reviews: "all" },
    });
  });

  test("an empty subscription stops listening and is valid", () => {
    expect(parseListenClientMessage('{"type":"subscribe","reviews":[]}')).toEqual({
      ok: true,
      value: { type: "subscribe", reviews: [] },
    });
  });

  test("refuses a blank Review id, an ack without id, other types and non-JSON", () => {
    expect(parseListenClientMessage('{"type":"subscribe","reviews":[" "]}')).toEqual({
      ok: false,
      error: ERRORS.subscription,
    });
    expect(parseListenClientMessage('{"type":"ack"}')).toEqual({ ok: false, error: ERRORS.ackId });
    expect(parseListenClientMessage('{"type":"poll"}')).toEqual({ ok: false, error: ERRORS.message });
    expect(parseListenClientMessage("subscribe")).toEqual({ ok: false, error: ERRORS.message });
  });
});

describe("local request", () => {
  const local = { host: "127.0.0.1:4397", origin: null, referer: null };

  test("lets a header-less local client through on either loopback name", () => {
    expect(isLocalRequest(local, 4397, true)).toBe(true);
    expect(isLocalRequest({ ...local, host: "localhost:4397" }, 4397, true)).toBe(true);
  });

  test("refuses a foreign Host, even when it names the right port", () => {
    expect(isLocalRequest({ ...local, host: "evil.example:4397" }, 4397, false)).toBe(false);
    expect(isLocalRequest({ ...local, host: "127.0.0.1:4398" }, 4397, false)).toBe(false);
    expect(isLocalRequest({ ...local, host: null }, 4397, false)).toBe(false);
  });

  test("refuses a foreign Origin or Referer only where origins are checked", () => {
    const foreign = { ...local, origin: "https://evil.example" };
    expect(isLocalRequest(foreign, 4397, true)).toBe(false);
    expect(isLocalRequest(foreign, 4397, false)).toBe(true);
    expect(isLocalRequest({ ...local, referer: "https://evil.example/page" }, 4397, true)).toBe(false);
    expect(isLocalRequest({ ...local, referer: "http://127.0.0.1:4397/plannotator/session/x/" }, 4397, true)).toBe(true);
  });
});

describe("review link", () => {
  test("keeps the page path and changes only the origin with the Visibility", () => {
    const origins = { local: "http://127.0.0.1:4397", public: "https://ctas.example", temporary: "https://t.example" };
    expect(reviewLink("0123456789abcdef", "local", origins)).toBe(
      "http://127.0.0.1:4397/plannotator/session/0123456789abcdef/",
    );
    expect(reviewLink("0123456789abcdef", "temporary", origins)).toBe(
      "https://t.example/plannotator/session/0123456789abcdef/",
    );
  });
});
