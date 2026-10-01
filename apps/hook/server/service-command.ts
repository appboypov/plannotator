/**
 * `plannotator service install|uninstall|status` (fork-owned): the review service as a
 * macOS LaunchAgent. See `launch-agent.ts` and fork/README.md.
 */
import { homedir } from "node:os";
import {
  CARRIED_SETTINGS,
  installBinary,
  launchdState,
  loadService,
  runLaunchctl,
  servicePlan,
  unloadService,
  type Launchctl,
  type ServicePlan,
} from "./launch-agent";

export const SERVICE_USAGE = [
  "Usage:",
  "  plannotator service install     Install this binary to ~/.local/bin and (re)start the LaunchAgent",
  "  plannotator service uninstall   Stop the LaunchAgent and remove its plist (the binary stays)",
  "  plannotator service status      Show launchd's state and the service's health",
  "",
  "The LaunchAgent nl.de-appspecialist.plannotator runs `plannotator serve`, keeps it alive and",
  "restarts it when it exits. Logs: ~/Library/Logs/plannotator/nl.de-appspecialist.plannotator.log.",
  `install carries these settings from its environment into the plist when set: ${CARRIED_SETTINGS.join(", ")}.`,
  "",
  "Build and install from a fork checkout: bun fork/build-binary.ts && fork/dist/plannotator service install",
].join("\n");

/** How long install waits for the restarted service to answer its health route. */
const READY_TIMEOUT_MS = 20_000;

export type ServiceHealth = { version: string; major: number | null; label: string | null };

export type ServiceCommandContext = {
  /** The running binary; installed when it is a compiled build. */
  execPath: string;
  /** This binary's build version, or undefined for a run from source. */
  version: string | undefined;
  platform: string;
  home: string;
  uid: number;
  env: Record<string, string | undefined>;
  launchctl: Launchctl;
  /** The service's health on [port], or null when nothing answers within [timeoutMs]. */
  readHealth: (port: number, timeoutMs: number) => Promise<ServiceHealth | null>;
  out: (line: string) => void;
};

/** Runs `service <action>` and answers the process exit code. */
export async function runServiceCommand(args: readonly string[], context: ServiceCommandContext): Promise<number> {
  const [action, ...rest] = args;
  if (action === "--help" || action === "-h" || action === undefined) {
    context.out(SERVICE_USAGE);
    return action === undefined ? 2 : 0;
  }
  if (rest.length > 0 || !["install", "uninstall", "status"].includes(action)) {
    context.out(`Unknown service arguments: ${args.join(" ")}\n\n${SERVICE_USAGE}`);
    return 2;
  }
  if (context.platform !== "darwin") {
    context.out("The Plannotator service is a macOS LaunchAgent. On this platform run `plannotator serve` under your own supervisor.");
    return 1;
  }
  const plan = servicePlan({ home: context.home, env: context.env });
  const domain = `gui/${context.uid}`;
  if (action === "install") return install(plan, domain, context);
  if (action === "uninstall") return uninstall(plan, domain, context);
  return status(plan, domain, context);
}

async function install(plan: ServicePlan, domain: string, context: ServiceCommandContext): Promise<number> {
  if (context.version === undefined) {
    context.out(
      "Run `service install` from a built binary, not from source: in the fork checkout, `bun fork/build-binary.ts && fork/dist/plannotator service install`.",
    );
    return 1;
  }
  const copied = installBinary(context.execPath, plan);
  context.out(copied ? `Installed plannotator ${context.version} at ${plan.binary}` : `${plan.binary} is this binary (${context.version})`);
  const { replaced } = await loadService(plan, { domain, launchctl: context.launchctl });
  context.out(`${replaced ? "Restarted" : "Started"} ${plan.label}: ${plan.plistFile}`);
  const carried = CARRIED_SETTINGS.filter((key) => plan.environment[key] !== undefined);
  if (carried.length > 0) context.out(`Settings carried into the plist: ${carried.map((key) => `${key}=${plan.environment[key]}`).join(" ")}`);

  const health = await context.readHealth(plan.port, READY_TIMEOUT_MS);
  if (health?.label !== plan.label || health.version !== context.version) {
    const seen = health === null ? "nothing answers" : `it answers as ${health.label ?? "a server launchd does not run"} with version ${health.version}`;
    context.out(`The service does not answer as ${plan.label} ${context.version} on 127.0.0.1:${plan.port}; ${seen}. See ${plan.logFile}.`);
    return 1;
  }
  context.out(`Healthy on http://127.0.0.1:${plan.port}: version ${health.version}, review API major ${health.major ?? "unknown"}. Logs: ${plan.logFile}`);
  return 0;
}

function uninstall(plan: ServicePlan, domain: string, context: ServiceCommandContext): number {
  const loaded = unloadService(plan, { domain, launchctl: context.launchctl });
  context.out(`${loaded ? "Stopped" : "Was not loaded:"} ${plan.label}; removed ${plan.plistFile}. ${plan.binary} stays.`);
  return 0;
}

async function status(plan: ServicePlan, domain: string, context: ServiceCommandContext): Promise<number> {
  const state = launchdState(plan, { domain, launchctl: context.launchctl });
  const health = state.loaded ? await context.readHealth(plan.port, 2_000) : null;
  context.out(`label: ${plan.label}`);
  context.out(`launchd: ${state.loaded ? `${state.state ?? "loaded"}${state.pid ? ` (pid ${state.pid})` : ""}` : "not loaded"}`);
  context.out(`plist: ${plan.plistFile}`);
  context.out(`binary: ${plan.binary}`);
  context.out(`logs: ${plan.logFile}`);
  context.out(
    `health: ${health ? `http://127.0.0.1:${plan.port} version ${health.version}, review API major ${health.major ?? "unknown"}, run by ${health.label ?? "a server launchd does not run"}` : `nothing answers on 127.0.0.1:${plan.port}`}`,
  );
  return state.loaded && state.state === "running" && health?.label === plan.label ? 0 : 1;
}

/** Polls `/plannotator/health` on [port] until it answers or [timeoutMs] passes. */
export async function readServiceHealth(port: number, timeoutMs: number): Promise<ServiceHealth | null> {
  const deadline = Date.now() + timeoutMs;
  do {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/plannotator/health`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) {
        const body = (await response.json()) as { version?: unknown; api?: { major?: unknown }; service?: { label?: unknown } };
        return {
          version: typeof body.version === "string" ? body.version : "",
          major: typeof body.api?.major === "number" ? body.api.major : null,
          label: typeof body.service?.label === "string" ? body.service.label : null,
        };
      }
    } catch {
      // Not answering yet: launchd is still starting the service.
    }
    await Bun.sleep(250);
  } while (Date.now() < deadline);
  return null;
}

/** The context of a real run. */
export function liveServiceContext(version: string | undefined): ServiceCommandContext {
  return {
    execPath: process.execPath,
    version,
    platform: process.platform,
    home: homedir(),
    uid: process.getuid?.() ?? 0,
    env: process.env,
    launchctl: runLaunchctl,
    readHealth: readServiceHealth,
    out: (line) => console.log(line),
  };
}
