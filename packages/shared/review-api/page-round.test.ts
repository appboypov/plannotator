import { describe, expect, test } from "bun:test";
import { installReviewPageRound, type PageClosure, type PageRoundGlobals } from "./page-round.ts";

const BASE = "/plannotator/session/0123456789abcdef/";

type Sent = { url: string; init?: RequestInit };

/** A page under [pathname] whose commands answer [answer]; its Round stream is driven by `push`. */
function page(pathname: string, answer: (sent: Sent) => Response = () => Response.json({ ok: true }), meta: string | null = null) {
  const sent: Sent[] = [];
  const closures: PageClosure[] = [];
  let stream: FakeEventSource | undefined;
  class FakeEventSource {
    onmessage: ((event: MessageEvent) => unknown) | null = null;
    constructor(readonly url: string) {
      stream = this;
    }
  }
  const globals = {
    location: { href: `http://127.0.0.1:4397${pathname}`, pathname },
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      sent.push({ url: String(input), init });
      return answer({ url: String(input), init });
    },
    EventSource: FakeEventSource,
    document: { querySelector: () => (meta === null ? null : { getAttribute: () => meta }) },
  } as unknown as PageRoundGlobals;
  const installed = installReviewPageRound(globals, (closure) => closures.push(closure));
  const push = async (round: number, state: string) => {
    await stream?.onmessage?.(new MessageEvent("message", { data: JSON.stringify({ review_id: "0123456789abcdef", round, state }) }));
  };
  return { globals, sent, closures, push, installed, streamUrl: () => stream?.url };
}

describe("installReviewPageRound", () => {
  test("a page outside a session path is left alone", () => {
    const outside = page("/");
    expect(outside.installed).toBe(false);
    expect(outside.streamUrl()).toBeUndefined();
  });

  test("the page's commands carry the Round it loaded; other calls are untouched", async () => {
    const review = page(BASE);
    expect(review.streamUrl()).toBe(`${BASE}api/review-round`);
    await review.push(2, "open");

    await review.globals.fetch(`${BASE}api/feedback`, { method: "POST", body: JSON.stringify({ annotations: [] }) });
    await review.globals.fetch("/api/approve", { method: "POST", body: JSON.stringify({ feedback: "ok" }) });
    await review.globals.fetch(`${BASE}api/exit?generation=4`, { method: "POST" });
    await review.globals.fetch(`${BASE}api/draft`, { method: "POST", body: JSON.stringify({ a: 1 }) });
    await review.globals.fetch(`${BASE}api/feedback`, { method: "POST", body: "not json" });

    expect(JSON.parse(String(review.sent[0].init?.body))).toEqual({ annotations: [], round: 2 });
    expect(JSON.parse(String(review.sent[1].init?.body))).toEqual({ feedback: "ok", round: 2 });
    expect(review.sent[2].url).toBe(`${BASE}api/exit?generation=4&round=2`);
    expect(review.sent[3].init?.body).toBe(JSON.stringify({ a: 1 }));
    expect(review.sent[4].init?.body).toBe("not json");
  });

  test("an end by someone else closes the page; the page's own Approve does not", async () => {
    const cancelled = page(BASE);
    await cancelled.push(1, "open");
    await cancelled.push(1, "cancelled");
    expect(cancelled.closures).toEqual([{ kind: "ended", state: "cancelled", round: 1 }]);

    const approved = page(BASE);
    await approved.push(1, "open");
    await approved.globals.fetch(`${BASE}api/approve`, { method: "POST", body: "{}" });
    await approved.push(1, "finished");
    expect(approved.closures).toEqual([]);
  });

  test("a later Round, or a refused command, closes the page once", async () => {
    const reopened = page(BASE);
    await reopened.push(1, "open");
    await reopened.push(2, "open");
    await reopened.push(2, "cancelled");
    expect(reopened.closures).toEqual([{ kind: "next-round", round: 2 }]);

    const refusal = { status: "ended", error: "round 1 has ended", round: 1, state: "finished", ended_by: "user" };
    const refused = page(BASE, () => Response.json(refusal, { status: 409 }));
    await refused.push(1, "open");
    const response = await refused.globals.fetch(`${BASE}api/feedback`, { method: "POST", body: "{}" });
    expect(await response.json()).toEqual(refusal);
    expect(refused.closures).toEqual([{ kind: "ended", state: "finished", round: 1 }]);

    const stale = page(BASE, () => Response.json({ status: "stale-round", error: "x", round: 3 }, { status: 409 }));
    await stale.globals.fetch(`${BASE}api/approve`, { method: "POST", body: "{}" });
    expect(stale.closures).toEqual([{ kind: "next-round", round: 3 }]);
  });

  test("an ended Round's closure gives way to a later Round, and nothing after that", async () => {
    const stale = page(BASE, undefined, "1");
    await stale.push(1, "cancelled");
    await stale.push(1, "cancelled");
    await stale.push(2, "open");
    await stale.push(3, "open");
    expect(stale.closures).toEqual([
      { kind: "ended", state: "cancelled", round: 1 },
      { kind: "next-round", round: 2 },
    ]);
  });

  test("the Round pinned in the page's HTML wins over the stream's first event", async () => {
    const pinned = page(BASE, undefined, "1");
    await pinned.globals.fetch(`${BASE}api/approve`, { method: "POST", body: "{}" });
    expect(JSON.parse(String(pinned.sent[0].init?.body))).toEqual({ round: 1 });
    await pinned.push(2, "open");
    expect(pinned.closures).toEqual([{ kind: "next-round", round: 2 }]);
  });
});
