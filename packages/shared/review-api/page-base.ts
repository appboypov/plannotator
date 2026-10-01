/**
 * A Review page lives under its own path, `/plannotator/session/<review_id>/`, on
 * whichever origin serves it (the service, the public door, the temporary door).
 * Upstream's plan page calls its API at the site root (`/api/plan`, `/api/feedback`,
 * ...). Installed once before the page renders, this module sends every such call to
 * the page's own path instead (`/plannotator/session/<review_id>/api/plan`), so each
 * page talks to its own Review's server. A page outside a session path (a plain
 * `plannotator annotate`) is left exactly as upstream wrote it.
 */
import { SESSION_PATH_PREFIX } from "./routes.ts";

const API_PREFIX = "/api/";

/**
 * The page's base path, such as `/plannotator/session/0123456789abcdef/`, read from its
 * location's pathname; `null` when the page does not live under a session path.
 */
export function reviewPageBase(pathname: string): string | null {
  const start = pathname.indexOf(SESSION_PATH_PREFIX);
  if (start === -1) return null;
  const idStart = start + SESSION_PATH_PREFIX.length;
  const idEnd = pathname.indexOf("/", idStart);
  if (idEnd <= idStart) return null;
  return pathname.slice(0, idEnd + 1);
}

/** The parts of the page's location a rebase reads. */
export type PageLocation = { href: string; host: string };

/**
 * `url` with a root API path (`/api/...` on the page's own host) moved under `base`.
 * A path-only URL stays path-only; an absolute one stays absolute (its scheme, such as
 * `ws:`, is kept). Any other URL comes back unchanged.
 */
export function rebaseApiUrl(url: string, base: string, location: PageLocation): string {
  if (url.startsWith(API_PREFIX)) return base + url.slice(1);
  let parsed: URL;
  try {
    parsed = new URL(url, location.href);
  } catch {
    return url;
  }
  if (parsed.host !== location.host || !parsed.pathname.startsWith(API_PREFIX)) return url;
  parsed.pathname = base + parsed.pathname.slice(1);
  return parsed.href;
}

/** The globals the page calls its API through. `window` satisfies it. */
export type PageGlobals = {
  location: PageLocation & { pathname: string };
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  EventSource: typeof EventSource;
  WebSocket: typeof WebSocket;
};

/**
 * Sends the page's `fetch`, `EventSource` and `WebSocket` calls to its own path when it
 * lives under a session path. Returns the rebase for URLs the page hands to the browser
 * some other way (image sources), or `null` when the page is not a Review page and
 * nothing was installed.
 */
export function installReviewPageBase(globals: PageGlobals): ((url: string) => string) | null {
  const base = reviewPageBase(globals.location.pathname);
  if (base === null) return null;
  const rebase = (url: string) => rebaseApiUrl(url, base, globals.location);

  const fetch = globals.fetch.bind(globals);
  globals.fetch = (input, init) => {
    if (typeof input === "string") return fetch(rebase(input), init);
    if (input instanceof URL) return fetch(rebase(input.href), init);
    const url = rebase(input.url);
    return fetch(url === input.url ? input : new Request(url, input), init);
  };

  const PageEventSource = globals.EventSource;
  globals.EventSource = class extends PageEventSource {
    constructor(url: string | URL, init?: EventSourceInit) {
      super(rebase(String(url)), init);
    }
  };

  const PageWebSocket = globals.WebSocket;
  globals.WebSocket = class extends PageWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(rebase(String(url)), protocols);
    }
  };

  return rebase;
}
