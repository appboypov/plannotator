import { join, resolve } from "node:path";
import { SERVICE_PORT, type Parsed } from "@plannotator/shared/review-api";
import { getPlannotatorDataDir } from "@plannotator/shared/data-dir";

/** Overrides the service port (default 4397), for dev runs and tests. `--port` wins over it. */
export const SERVICE_PORT_ENV = "PLANNOTATOR_SERVICE_PORT";

/** Overrides the folder that holds one folder per Review (default `<data dir>/reviews`). */
export const REVIEWS_DIR_ENV = "PLANNOTATOR_REVIEWS_DIR";

/** What `plannotator serve` runs with. */
export type ReviewServiceSettings = {
  /** The port on 127.0.0.1; `0` picks a free one. */
  port: number;
  /** Absolute folder holding `<review_id>/review.json` per Review. */
  reviewsDir: string;
};

/**
 * Reads the service settings from `serve`'s arguments (after the subcommand) and the
 * environment: `--port <n>` over `PLANNOTATOR_SERVICE_PORT` over 4397, and
 * `PLANNOTATOR_REVIEWS_DIR` over `<PLANNOTATOR_DATA_DIR or ~/.plannotator>/reviews`.
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
  return { ok: true, value: { port: port.value, reviewsDir } };
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
