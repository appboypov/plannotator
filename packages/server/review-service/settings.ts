import { join, resolve } from "node:path";
import { PUBLIC_PORT, SERVICE_PORT, type Parsed } from "@plannotator/shared/review-api";
import { getPlannotatorDataDir } from "@plannotator/shared/data-dir";
import type { DoorListen } from "./doors.ts";

/** Overrides the service port (default 4397), for dev runs and tests. `--port` wins over it. */
export const SERVICE_PORT_ENV = "PLANNOTATOR_SERVICE_PORT";

/** Overrides the folder that holds one folder per Review (default `<data dir>/reviews`). */
export const REVIEWS_DIR_ENV = "PLANNOTATOR_REVIEWS_DIR";

/** The public door's address (default this Mac's Tailscale address, 100.111.186.85). */
export const PUBLIC_HOST_ENV = "PLANNOTATOR_PUBLIC_HOST";

/** The public door's port (default 4399); `off` starts no public door. */
export const PUBLIC_PORT_ENV = "PLANNOTATOR_PUBLIC_PORT";

/** The one address the public door accepts (default the VPS, 100.67.134.112). */
export const PUBLIC_PEER_ENV = "PLANNOTATOR_PUBLIC_PEER";

/** This Mac's Tailscale address, which Caddy on the VPS proxies `/plannotator/*` to. */
export const DEFAULT_PUBLIC_HOST = "100.111.186.85";

/** The VPS's Tailscale address: the only peer of the public door. */
export const DEFAULT_PUBLIC_PEER = "100.67.134.112";

/** What `plannotator serve` runs with. */
export type ReviewServiceSettings = {
  /** The port on 127.0.0.1; `0` picks a free one. */
  port: number;
  /** Absolute folder holding `<review_id>/review.json` per Review. */
  reviewsDir: string;
  /** The public door for ctas, or null when `PLANNOTATOR_PUBLIC_PORT` is `off`. */
  publicDoor: DoorListen | null;
};

/**
 * Reads the service settings from `serve`'s arguments (after the subcommand) and the
 * environment: `--port <n>` over `PLANNOTATOR_SERVICE_PORT` over 4397;
 * `PLANNOTATOR_REVIEWS_DIR` over `<PLANNOTATOR_DATA_DIR or ~/.plannotator>/reviews`;
 * the public door from `PLANNOTATOR_PUBLIC_HOST`, `_PORT` and `_PEER` over the live
 * values (100.111.186.85:4399 for 100.67.134.112).
 */
export function resolveServiceSettings(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Parsed<ReviewServiceSettings> {
  let portText = env[SERVICE_PORT_ENV]?.trim() || undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--port") {
      portText = args[index + 1];
      if (portText === undefined) return { ok: false, error: "--port needs a value" };
      index += 1;
    } else if (arg.startsWith("--port=")) {
      portText = arg.slice("--port=".length);
    } else {
      return { ok: false, error: `unknown argument: ${arg}` };
    }
  }

  const port = portText === undefined ? SERVICE_PORT : parsePort(portText);
  if (port === undefined) {
    return { ok: false, error: `port must be an integer from 0 to 65535, got ${JSON.stringify(portText)}` };
  }

  const reviewsDirText = env[REVIEWS_DIR_ENV]?.trim();
  const reviewsDir = reviewsDirText ? resolve(reviewsDirText) : join(getPlannotatorDataDir(), "reviews");

  const publicPortText = env[PUBLIC_PORT_ENV]?.trim() || undefined;
  let publicDoor: DoorListen | null = null;
  if (publicPortText !== "off") {
    const publicPort = publicPortText === undefined ? PUBLIC_PORT : parsePort(publicPortText);
    if (publicPort === undefined) {
      return { ok: false, error: `${PUBLIC_PORT_ENV} must be off or an integer from 0 to 65535, got ${JSON.stringify(publicPortText)}` };
    }
    publicDoor = {
      host: env[PUBLIC_HOST_ENV]?.trim() || DEFAULT_PUBLIC_HOST,
      port: publicPort,
      peer: env[PUBLIC_PEER_ENV]?.trim() || DEFAULT_PUBLIC_PEER,
    };
  }
  return { ok: true, value: { port, reviewsDir, publicDoor } };
}

/** [text] as a TCP port (0 picks a free one), or undefined when it is not one. */
function parsePort(text: string): number | undefined {
  const port = Number(text);
  return /^\d+$/.test(text) && Number.isInteger(port) && port <= 65535 ? port : undefined;
}
