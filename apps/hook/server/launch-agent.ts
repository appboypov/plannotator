/**
 * The review service's LaunchAgent (fork-owned): `plannotator service install` puts the
 * running binary at `~/.local/bin/plannotator` and has launchd run `plannotator serve`
 * under `nl.de-appspecialist.plannotator`, kept alive and restarted when it exits.
 * The parity reference is `~/Repos/Forks/pew-pew-lavish/src/launch-agent.js`.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { PUBLIC_PORT, TEMPORARY_PORT } from "@plannotator/shared/review-api";
import {
  DEFAULT_PUBLIC_HOST,
  DEFAULT_PUBLIC_PEER,
  PUBLIC_HOST_ENV,
  PUBLIC_PEER_ENV,
  PUBLIC_PORT_ENV,
  TEMPORARY_PORT_ENV,
} from "@plannotator/server/review-service";

export const SERVICE_LABEL = "nl.de-appspecialist.plannotator";

/** Tells `plannotator serve` which LaunchAgent runs it, so `/plannotator/health` can say so. */
export const SERVICE_LABEL_ENV = "PLANNOTATOR_SERVICE_LABEL";

/**
 * The live doors the LaunchAgent runs (as Lavish's live profile carries its ports): the
 * public door on this Mac's Tailscale address for the VPS, the temporary door on
 * 127.0.0.1 for ngrok. `plannotator serve` run by hand opens no door, so a dev run never
 * binds the Tailscale address or claims the live ports.
 */
export const LIVE_DOOR_SETTINGS: Readonly<Record<string, string>> = {
  [PUBLIC_HOST_ENV]: DEFAULT_PUBLIC_HOST,
  [PUBLIC_PORT_ENV]: String(PUBLIC_PORT),
  [PUBLIC_PEER_ENV]: DEFAULT_PUBLIC_PEER,
  [TEMPORARY_PORT_ENV]: String(TEMPORARY_PORT),
};

/**
 * Settings `plannotator serve` reads that `service install` carries from its own
 * environment into the plist when they are set, over the live door settings; `off` as a
 * door port installs the service without that door.
 */
export const CARRIED_SETTINGS = [
  "PLANNOTATOR_SERVICE_PORT",
  "PLANNOTATOR_REVIEWS_DIR",
  "PLANNOTATOR_DATA_DIR",
  "PLANNOTATOR_PUBLIC_HOST",
  "PLANNOTATOR_PUBLIC_PORT",
  "PLANNOTATOR_PUBLIC_PEER",
  "PLANNOTATOR_TEMPORARY_PORT",
  "PLANNOTATOR_TEMPORARY_ORIGIN",
  "PLANNOTATOR_MULTICA_PROFILE",
] as const;

const DEFAULT_PORT = 4397;
const LOG_DIR_NAME = "plannotator";
// launchd unloads a booted-out service asynchronously; bootstrapping the same label before
// that finishes fails with an I/O error, so the install retries for a bounded window.
const BOOTSTRAP_ATTEMPTS = 20;
const BOOTSTRAP_RETRY_MS = 250;

export type ServicePlan = {
  label: string;
  port: number;
  /** Where the binary is installed and what launchd runs. */
  binary: string;
  plistFile: string;
  logDir: string;
  logFile: string;
  programArguments: string[];
  environment: Record<string, string>;
};

export type LaunchctlResult = { status: number | null; stdout: string; stderr: string };
export type Launchctl = (args: string[]) => LaunchctlResult;

/** Settings holding a folder: carried as absolute paths, since launchd runs serve from another working directory. */
const FOLDER_SETTINGS: Record<string, true> = { PLANNOTATOR_REVIEWS_DIR: true, PLANNOTATOR_DATA_DIR: true };

/** The [CARRIED_SETTINGS] the installing environment sets, folder settings made absolute against [cwd]. */
export function carriedSettings(env: Record<string, string | undefined>, cwd: string): Record<string, string> {
  const carried: Record<string, string> = {};
  for (const key of CARRIED_SETTINGS) {
    const value = env[key]?.trim();
    if (value) carried[key] = FOLDER_SETTINGS[key] ? resolve(cwd, value) : value;
  }
  return carried;
}

/**
 * Everything the LaunchAgent is made of. Pure, so the plist is testable without launchd. `port` is
 * NaN for a `PLANNOTATOR_SERVICE_PORT` that is not a number; install refuses it and port 0.
 */
export function servicePlan({ home, cwd, env }: { home: string; cwd: string; env: Record<string, string | undefined> }): ServicePlan {
  const binary = join(home, ".local", "bin", "plannotator");
  const logDir = join(home, "Library", "Logs", LOG_DIR_NAME);
  const carried = carriedSettings(env, cwd);
  const portText = carried.PLANNOTATOR_SERVICE_PORT;
  return {
    label: SERVICE_LABEL,
    port: portText === undefined ? DEFAULT_PORT : /^\d+$/.test(portText) ? Number(portText) : Number.NaN,
    binary,
    plistFile: join(home, "Library", "LaunchAgents", `${SERVICE_LABEL}.plist`),
    logDir,
    logFile: join(logDir, `${SERVICE_LABEL}.log`),
    programArguments: [binary, "serve"],
    environment: {
      [SERVICE_LABEL_ENV]: SERVICE_LABEL,
      // launchd starts with /usr/bin:/bin:/usr/sbin:/sbin; pages run git and other tools.
      PATH: [join(home, ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(":"),
      ...LIVE_DOOR_SETTINGS,
      PLANNOTATOR_MULTICA_PROFILE: "skuddy",
      ...carried,
    },
  };
}

/** The plan's launchd property list. */
export function renderPlist(plan: ServicePlan): string {
  const string = (value: string) => `<string>${escapeXml(value)}</string>`;
  const programArguments = plan.programArguments.map((arg) => `    ${string(arg)}`).join("\n");
  const environment = Object.entries(plan.environment)
    .map(([key, value]) => `    <key>${escapeXml(key)}</key>\n    ${string(value)}`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  ${string(plan.label)}
  <key>ProgramArguments</key>
  <array>
${programArguments}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${environment}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  ${string(plan.logFile)}
  <key>StandardErrorPath</key>
  ${string(plan.logFile)}
</dict>
</plist>
`;
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export const runLaunchctl: Launchctl = (args) => {
  const result = spawnSync("launchctl", args, { encoding: "utf8" });
  if (result.error) return { status: null, stdout: "", stderr: result.error.message };
  return { status: result.status, stdout: result.stdout || "", stderr: result.stderr || "" };
};

/**
 * Copies [source] to the plan's binary through a temporary file in the same folder, so
 * a running `plannotator` keeps its old file and nothing ever sees half a binary.
 * Answers false when [source] already is the installed binary.
 */
export function installBinary(source: string, plan: ServicePlan): boolean {
  if (existsSync(plan.binary) && realpathSync(source) === realpathSync(plan.binary)) return false;
  mkdirSync(dirname(plan.binary), { recursive: true });
  const temporary = `${plan.binary}.installing-${process.pid}`;
  try {
    copyFileSync(source, temporary);
    chmodSync(temporary, 0o755);
    renameSync(temporary, plan.binary);
  } finally {
    rmSync(temporary, { force: true });
  }
  return true;
}

/**
 * Writes the plist and loads it into [domain] (`gui/<uid>`), replacing a loaded service with
 * the same label: launchd stops the old process and starts the new one.
 */
export async function loadService(
  plan: ServicePlan,
  { domain, launchctl = runLaunchctl, retryDelayMs = BOOTSTRAP_RETRY_MS }: { domain: string; launchctl?: Launchctl; retryDelayMs?: number },
): Promise<{ replaced: boolean }> {
  mkdirSync(dirname(plan.plistFile), { recursive: true });
  mkdirSync(plan.logDir, { recursive: true });
  const temporary = `${plan.plistFile}.writing-${process.pid}`;
  writeFileSync(temporary, renderPlist(plan));
  renameSync(temporary, plan.plistFile);

  const replaced = launchctl(["bootout", `${domain}/${plan.label}`]).status === 0;
  let bootstrap: LaunchctlResult = { status: null, stdout: "", stderr: "" };
  for (let attempt = 1; attempt <= BOOTSTRAP_ATTEMPTS; attempt += 1) {
    bootstrap = launchctl(["bootstrap", domain, plan.plistFile]);
    if (bootstrap.status === 0) return { replaced };
    if (attempt < BOOTSTRAP_ATTEMPTS) await Bun.sleep(retryDelayMs);
  }
  throw new Error(
    `launchd did not load ${plan.label}: launchctl bootstrap ${domain} ${plan.plistFile} failed with status ${bootstrap.status}: ${bootstrap.stderr.trim() || bootstrap.stdout.trim()}. Inspect it with \`launchctl print ${domain}/${plan.label}\`, then run the install again.`,
  );
}

/**
 * Unloads the service and removes its plist. Answers whether launchd had it loaded. A loaded
 * service launchd fails to unload keeps its plist, so it is never left running without one.
 */
export function unloadService(plan: ServicePlan, { domain, launchctl = runLaunchctl }: { domain: string; launchctl?: Launchctl }): boolean {
  const target = `${domain}/${plan.label}`;
  const loaded = launchctl(["print", target]).status === 0;
  if (loaded) {
    const bootout = launchctl(["bootout", target]);
    if (bootout.status !== 0) {
      throw new Error(
        `launchd did not unload ${plan.label}: launchctl bootout ${target} failed with status ${bootout.status}: ${bootout.stderr.trim() || bootout.stdout.trim()}. ${plan.plistFile} stays.`,
      );
    }
  }
  rmSync(plan.plistFile, { force: true });
  return loaded;
}

export type LaunchdState = { loaded: boolean; state: string | null; pid: number | null };

/** What `launchctl print` says about the service. */
export function launchdState(plan: ServicePlan, { domain, launchctl = runLaunchctl }: { domain: string; launchctl?: Launchctl }): LaunchdState {
  const printed = launchctl(["print", `${domain}/${plan.label}`]);
  if (printed.status !== 0) return { loaded: false, state: null, pid: null };
  const state = /^\s*state = (.+)$/m.exec(printed.stdout)?.[1]?.trim() ?? null;
  const pid = /^\s*pid = (\d+)$/m.exec(printed.stdout)?.[1];
  return { loaded: true, state, pid: pid ? Number(pid) : null };
}

/** The port the installed plist runs the service on: its `PLANNOTATOR_SERVICE_PORT`, else the default; null without a plist. */
export function installedPort(plan: ServicePlan): number | null {
  if (!existsSync(plan.plistFile)) return null;
  const plist = readFileSync(plan.plistFile, "utf8");
  const port = /<key>PLANNOTATOR_SERVICE_PORT<\/key>\s*<string>(\d+)<\/string>/.exec(plist)?.[1];
  return port ? Number(port) : DEFAULT_PORT;
}
