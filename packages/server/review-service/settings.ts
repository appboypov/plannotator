import { join, resolve } from "node:path";
import { DEFAULT_TEMPORARY_ORIGIN, SERVICE_PORT, type Parsed } from "@plannotator/shared/review-api";
import { getPlannotatorDataDir } from "@plannotator/shared/data-dir";
import type { DoorListen } from "./doors.ts";

/** Overrides the service port (default 4397), for dev runs and tests. `--port` wins over it. */
export const SERVICE_PORT_ENV = "PLANNOTATOR_SERVICE_PORT";

/** Overrides the folder that holds one folder per Review (default `<data dir>/reviews`). */
export const REVIEWS_DIR_ENV = "PLANNOTATOR_REVIEWS_DIR";

/** The CLI profile whose member posts linked Review events. Never a token. */
export const MULTICA_PROFILE_ENV = "PLANNOTATOR_MULTICA_PROFILE";

/** The public door's address (default this Mac's Tailscale address, 100.111.186.85). */
export const PUBLIC_HOST_ENV = "PLANNOTATOR_PUBLIC_HOST";

/** The public door's port; unset or `off` starts no public door. */
export const PUBLIC_PORT_ENV = "PLANNOTATOR_PUBLIC_PORT";

/** The one address the public door accepts (default the VPS, 100.67.134.112). */
export const PUBLIC_PEER_ENV = "PLANNOTATOR_PUBLIC_PEER";

/** The temporary door's port on 127.0.0.1; unset or `off` starts no temporary door. */
export const TEMPORARY_PORT_ENV = "PLANNOTATOR_TEMPORARY_PORT";

/** The origin of `temporary` links, whose hostname is the only one the temporary door answers. */
export const TEMPORARY_ORIGIN_ENV = "PLANNOTATOR_TEMPORARY_ORIGIN";

/** This Mac's Tailscale address, which Caddy on the VPS proxies `/plannotator/*` to. */
export const DEFAULT_PUBLIC_HOST = "100.111.186.85";

/** The VPS's Tailscale address: the only peer of the public door. */
export const DEFAULT_PUBLIC_PEER = "100.67.134.112";

/**
 * The temporary door's address and its only peer: ngrok's agent on this Mac forwards to
 * it, so the door never binds or accepts anything but loopback.
 */
export const TEMPORARY_DOOR_HOST = "127.0.0.1";

/** What `plannotator serve` runs with. */
export type ReviewServiceSettings = {
  /** The port on 127.0.0.1; `0` picks a free one. */
  port: number;
  /** Absolute folder holding `<review_id>/review.json` per Review. */
  reviewsDir: string;
  /** The public door for ctas, or null when `PLANNOTATOR_PUBLIC_PORT` is unset or `off`. */
  publicDoor: DoorListen | null;
  /** The temporary door's port on 127.0.0.1, or null when `PLANNOTATOR_TEMPORARY_PORT` is unset or `off`. */
  temporaryPort: number | null;
  /** The origin `temporary` links live on, without a trailing slash. */
  temporaryOrigin: string;
  multicaProfile: string | null;
};

/**
 * Reads the service settings from `serve`'s arguments (after the subcommand) and the
 * environment: `--port <n>` over `PLANNOTATOR_SERVICE_PORT` over 4397;
 * `PLANNOTATOR_REVIEWS_DIR` over `<PLANNOTATOR_DATA_DIR or ~/.plannotator>/reviews`.
 * A door opens only when its port is set: run by hand, `serve` binds nothing but
 * 127.0.0.1:<port>; `plannotator service install` writes the live door ports into the
 * LaunchAgent. The public door takes `PLANNOTATOR_PUBLIC_HOST` and `_PEER` over the live
 * values (100.111.186.85 for 100.67.134.112); the temporary door is always loopback, and
 * `PLANNOTATOR_TEMPORARY_ORIGIN` names its host over the fixed ngrok address.
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

  const port = parsePort(portText);
  if (!port.ok) return port;

  const reviewsDirText = env[REVIEWS_DIR_ENV]?.trim();
  const reviewsDir = reviewsDirText ? resolve(reviewsDirText) : join(getPlannotatorDataDir(), "reviews");

  const publicPort = parseDoorPort(PUBLIC_PORT_ENV, env);
  if (!publicPort.ok) return publicPort;
  const publicDoor: DoorListen | null =
    publicPort.value === null
      ? null
      : {
          host: env[PUBLIC_HOST_ENV]?.trim() || DEFAULT_PUBLIC_HOST,
          port: publicPort.value,
          peer: env[PUBLIC_PEER_ENV]?.trim() || DEFAULT_PUBLIC_PEER,
        };

  const temporaryPort = parseDoorPort(TEMPORARY_PORT_ENV, env);
  if (!temporaryPort.ok) return temporaryPort;
  const temporaryOrigin = parseOrigin(env[TEMPORARY_ORIGIN_ENV]?.trim() || DEFAULT_TEMPORARY_ORIGIN);
  if (temporaryOrigin === null) {
    return { ok: false, error: `${TEMPORARY_ORIGIN_ENV} must be an http or https origin, got ${JSON.stringify(env[TEMPORARY_ORIGIN_ENV])}` };
  }

  return {
    ok: true,
    value: { port: port.value, reviewsDir, publicDoor, temporaryPort: temporaryPort.value, temporaryOrigin,
      multicaProfile: env[MULTICA_PROFILE_ENV]?.trim() || null },
  };
}

/** A door's port from [name]: null when unset or `off`. */
function parseDoorPort(name: string, env: NodeJS.ProcessEnv): Parsed<number | null> {
  const text = env[name]?.trim() || undefined;
  if (text === undefined || text === "off") return { ok: true, value: null };
  const port = parsePort(text);
  if (!port.ok) return { ok: false, error: `${name} must be off or an integer from 0 to 65535, got ${JSON.stringify(text)}` };
  return port;
}

/** [text] as a bare http(s) origin (a trailing slash is dropped), or null. */
function parseOrigin(text: string): string | null {
  if (!URL.canParse(text)) return null;
  const url = new URL(text);
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  return text.replace(/\/$/, "") === url.origin ? url.origin : null;
}

/**
 * The port a client such as `plannotator annotate` finds the service on: the same
 * `PLANNOTATOR_SERVICE_PORT` setting `serve` reads, else 4397. `0` is refused, since a
 * client cannot reach a port the service picked for itself.
 */
export function resolveServicePort(env: NodeJS.ProcessEnv = process.env): Parsed<number> {
  const port = parsePort(env[SERVICE_PORT_ENV]?.trim() || undefined);
  if (port.ok && port.value === 0) return { ok: false, error: `${SERVICE_PORT_ENV} must name the service's port, got 0` };
  return port;
}

/** [portText] as a port from 0 to 65535; absent is 4397. */
function parsePort(portText: string | undefined): Parsed<number> {
  const port = portText === undefined ? SERVICE_PORT : Number(portText);
  if (!Number.isInteger(port) || port < 0 || port > 65535 || (portText !== undefined && !/^\d+$/.test(portText))) {
    return { ok: false, error: `port must be an integer from 0 to 65535, got ${JSON.stringify(portText)}` };
  }
  return { ok: true, value: port };
}
