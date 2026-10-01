import { describe, expect, test } from "bun:test";
import { installReviewPageBase, rebaseApiUrl, reviewPageBase, type PageGlobals } from "./page-base.ts";

const BASE = "/plannotator/session/0123456789abcdef/";
const LOCATION = { href: `http://127.0.0.1:4397${BASE}`, host: "127.0.0.1:4397" };

describe("reviewPageBase", () => {
  test("a page under a session path, with or without a trailing rest", () => {
    expect(reviewPageBase(BASE)).toBe(BASE);
    expect(reviewPageBase(`${BASE}index.html`)).toBe(BASE);
  });

  test("a session path behind a proxy prefix keeps the prefix", () => {
    expect(reviewPageBase(`/door${BASE}`)).toBe(`/door${BASE}`);
  });

  test("a page outside a session path, or without an id and slash, has none", () => {
    expect(reviewPageBase("/")).toBeNull();
    expect(reviewPageBase("/plannotator/session/")).toBeNull();
    expect(reviewPageBase("/plannotator/session/0123456789abcdef")).toBeNull();
  });
});

describe("rebaseApiUrl", () => {
  test("a root API path moves under the page base with its query", () => {
    expect(rebaseApiUrl("/api/doc?path=a.md&doc=1", BASE, LOCATION)).toBe(`${BASE}api/doc?path=a.md&doc=1`);
  });

  test("an absolute same-host API URL keeps its scheme", () => {
    expect(rebaseApiUrl("http://127.0.0.1:4397/api/plan", BASE, LOCATION)).toBe(`http://127.0.0.1:4397${BASE}api/plan`);
    expect(rebaseApiUrl("ws://127.0.0.1:4397/api/agent/ws", BASE, LOCATION)).toBe(`ws://127.0.0.1:4397${BASE}api/agent/ws`);
  });

  test("other hosts, non-API paths and already rebased paths are unchanged", () => {
    for (const url of ["https://example.com/api/plan", "/apix", "/favicon.ico", `${BASE}api/plan`, "data:image/png;base64,AA"]) {
      expect(rebaseApiUrl(url, BASE, LOCATION)).toBe(url);
    }
  });
});

describe("installReviewPageBase", () => {
  function pageGlobals(pathname: string) {
    const requested: string[] = [];
    class RecordingSocket {
      constructor(url: string | URL) {
        requested.push(String(url));
      }
    }
    const globals = {
      location: { ...LOCATION, href: `http://127.0.0.1:4397${pathname}`, pathname },
      fetch: async (input: RequestInfo | URL) => {
        requested.push(input instanceof Request ? input.url : String(input));
        return new Response("{}");
      },
      EventSource: RecordingSocket as unknown as typeof EventSource,
      WebSocket: RecordingSocket as unknown as typeof WebSocket,
    } satisfies PageGlobals;
    return { globals: globals as PageGlobals, requested };
  }

  test("a Review page's fetch, Request, EventSource and WebSocket calls reach its own path", async () => {
    const { globals, requested } = pageGlobals(BASE);
    const rebase = installReviewPageBase(globals);
    await globals.fetch("/api/plan");
    await globals.fetch(new Request("http://127.0.0.1:4397/api/feedback", { method: "POST", body: "{}" }));
    new globals.EventSource("/api/external-annotations/stream");
    new globals.WebSocket("ws://127.0.0.1:4397/api/terminal");
    expect(requested).toEqual([
      `${BASE}api/plan`,
      `http://127.0.0.1:4397${BASE}api/feedback`,
      `${BASE}api/external-annotations/stream`,
      `ws://127.0.0.1:4397${BASE}api/terminal`,
    ]);
    expect(rebase?.("/api/image?path=a.png")).toBe(`${BASE}api/image?path=a.png`);
  });

  test("a page outside a session path keeps upstream's root calls", async () => {
    const { globals, requested } = pageGlobals("/");
    expect(installReviewPageBase(globals)).toBeNull();
    await globals.fetch("/api/plan");
    expect(requested).toEqual(["/api/plan"]);
  });
});
