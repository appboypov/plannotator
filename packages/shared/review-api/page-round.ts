/**
 * A Review page shows one Round. Installed before the page renders, this module learns
 * that Round from the service's Round stream (`<base>api/review-round`), sends it as
 * `round` with the page's Round-checked commands (Send feedback, Approve, Close), and
 * closes the page when its Round ends by someone else's hand (an agent's Cancel,
 * another tab's Approve), when a command is refused with HTTP 409, or when a later
 * Round opens. A page outside a session path is left as upstream wrote it.
 */
import { reviewPageBase } from "./page-base.ts";
import type { EndedState, RoundRefusal, Round } from "./types.ts";

/** The service's Round stream of a Review page, relative to the page's base path. */
export const PAGE_ROUND_PATH = "api/review-round";

/** The `<meta>` the service puts in a Review page's HTML: the Round the page was loaded in. */
export const PAGE_ROUND_META = "plannotator-review-round";

/** Why a page closed: its Round ended, or a later Round is open. */
export type PageClosure = { kind: "ended"; state: EndedState; round: number } | { kind: "next-round"; round: number };

/** The globals the Round module reads and wraps. `window` satisfies it. */
export type PageRoundGlobals = {
  location: { href: string; pathname: string };
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  EventSource: typeof EventSource;
  document: { querySelector: (selector: string) => { getAttribute: (name: string) => string | null } | null };
};

type Command = "feedback" | "approve" | "exit";

const COMMANDS: readonly Command[] = ["feedback", "approve", "exit"];

/**
 * Installs the Round module when the page lives under a session path; [close] shows a
 * closure: an ended Round at most once, then a later Round at most once, which replaces
 * it. Returns false, installing nothing, outside one.
 */
export function installReviewPageRound(globals: PageRoundGlobals, close: (closure: PageClosure) => void): boolean {
  const base = reviewPageBase(globals.location.pathname);
  if (base === null) return false;

  let shown: PageClosure["kind"] | null = null;
  const show = (closure: PageClosure) => {
    if (shown === "next-round" || shown === closure.kind) return;
    shown = closure.kind;
    close(closure);
  };
  // The Round the page was loaded in, pinned by its HTML so a reconnecting stream cannot move it.
  const pinned = Number(globals.document.querySelector(`meta[name="${PAGE_ROUND_META}"]`)?.getAttribute("content"));
  let loaded: number | undefined = Number.isInteger(pinned) && pinned > 0 ? pinned : undefined;
  // The page's own Approve or Close in flight: its end is not someone else's.
  let ending: Promise<boolean> | null = null;
  let endedHere = false;

  const stream = new globals.EventSource(`${base}${PAGE_ROUND_PATH}`);
  stream.onmessage = async (event: MessageEvent) => {
    const round = parseRound(event.data);
    if (!round) return;
    loaded ??= round.round;
    if (round.round > loaded) return show({ kind: "next-round", round: round.round });
    if (round.state === "open") return;
    if (ending && (await ending)) return;
    if (!endedHere) show({ kind: "ended", state: round.state, round: round.round });
  };

  const fetch = globals.fetch.bind(globals);
  globals.fetch = async (input, init) => {
    const command = typeof input === "string" || input instanceof URL ? commandOf(String(input), base, globals.location.href) : null;
    if (!command || (init?.method ?? "GET").toUpperCase() !== "POST") return fetch(input, init);
    const sent = withRound(command, String(input), init, loaded);
    const answer = fetch(sent.url, sent.init);
    if (command !== "feedback") {
      ending = answer.then((response) => response.ok, () => false);
      ending.then((ended) => {
        if (ended) endedHere = true;
      });
    }
    const response = await answer;
    if (response.status === 409) {
      const refusal = parseRefusal(await response.clone().text());
      if (refusal?.status === "stale-round") show({ kind: "next-round", round: refusal.round });
      else if (refusal?.status === "ended") show({ kind: "ended", state: refusal.state ?? "cancelled", round: refusal.round });
    }
    return response;
  };
  return true;
}

/** Which Round-checked command [url] calls, at the site root or under [base]; null for any other call. */
function commandOf(url: string, base: string, href: string): Command | null {
  let pathname: string;
  try {
    pathname = new URL(url, href).pathname;
  } catch {
    return null;
  }
  return COMMANDS.find((command) => pathname === `/api/${command}` || pathname === `${base}api/${command}`) ?? null;
}

/**
 * The command with the page's Round: in the JSON body of Send feedback and Approve, as
 * the `round` query of Close, which has no body. Unchanged while the Round is unknown
 * or the body is not a JSON object.
 */
function withRound(command: Command, url: string, init: RequestInit | undefined, round: number | undefined): { url: string; init?: RequestInit } {
  if (round === undefined) return { url, init };
  if (command === "exit") return { url: `${url}${url.includes("?") ? "&" : "?"}round=${round}`, init };
  if (typeof init?.body !== "string") return { url, init };
  let body: unknown;
  try {
    body = JSON.parse(init.body);
  } catch {
    return { url, init };
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) return { url, init };
  return { url, init: { ...init, body: JSON.stringify({ ...body, round }) } };
}

function parseRound(data: unknown): Round | undefined {
  const value = parseObject(data);
  if (!value) return undefined;
  const { review_id, round, state } = value;
  if (typeof review_id !== "string" || typeof round !== "number") return undefined;
  if (state !== "open" && state !== "finished" && state !== "cancelled") return undefined;
  return { review_id, round, state };
}

function parseRefusal(data: string): RoundRefusal | undefined {
  const value = parseObject(data);
  if (!value || typeof value.round !== "number" || typeof value.error !== "string") return undefined;
  if (value.status === "stale-round") return { status: "stale-round", error: value.error, round: value.round };
  if (value.status !== "ended") return undefined;
  const state = value.state === "finished" || value.state === "cancelled" ? value.state : null;
  const endedBy = value.ended_by === "user" || value.ended_by === "agent" ? value.ended_by : null;
  return { status: "ended", error: value.error, round: value.round, state, ended_by: endedBy };
}

function parseObject(data: unknown): Record<string, unknown> | undefined {
  if (typeof data !== "string") return undefined;
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return undefined;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  // A parsed JSON object: string keys, unknown values.
  const fields: Record<string, unknown> = { ...value };
  return fields;
}
