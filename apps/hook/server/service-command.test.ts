import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderPlist, servicePlan, SERVICE_LABEL, type LaunchctlResult } from "./launch-agent";
import { runServiceCommand, type ServiceCommandContext, type ServiceHealth } from "./service-command";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "plannotator-service-"));
  dirs.push(dir);
  return dir;
}

const OK: LaunchctlResult = { status: 0, stdout: "", stderr: "" };

/** A context on a temporary home whose launchctl answers from [answer] and records every call. */
function context(overrides: Partial<ServiceCommandContext> & { answer?: (args: string[]) => LaunchctlResult } = {}) {
  const home = tempDir();
  const binary = join(tempDir(), "plannotator");
  writeFileSync(binary, "built binary");
  const calls: string[] = [];
  const lines: string[] = [];
  const health: ServiceHealth = { version: "0.27.23-appboypov.abc", major: 1, label: SERVICE_LABEL };
  const ctx: ServiceCommandContext = {
    execPath: binary,
    version: "0.27.23-appboypov.abc",
    platform: "darwin",
    home,
    cwd: "/work",
    uid: 501,
    env: {},
    launchctl: (args) => (calls.push(args.join(" ")), (overrides.answer ?? (() => OK))(args)),
    readHealth: async () => health,
    out: (line) => void lines.push(line),
    ...overrides,
  };
  return { ctx, home, calls, lines, plan: servicePlan({ home, cwd: ctx.cwd, env: ctx.env }) };
}

describe("the LaunchAgent plist", () => {
  test("Given no settings, launchd runs the installed binary's serve, keeps it alive and logs under ~/Library/Logs", () => {
    const plan = servicePlan({ home: "/Users/me", cwd: "/work", env: {} });
    const plist = renderPlist(plan);
    expect(plan.programArguments).toEqual(["/Users/me/.local/bin/plannotator", "serve"]);
    expect(plist).toContain("<key>KeepAlive</key>\n  <true/>");
    expect(plist).toContain("<key>RunAtLoad</key>\n  <true/>");
    expect(plist).toContain("<string>/Users/me/Library/Logs/plannotator/nl.de-appspecialist.plannotator.log</string>");
    expect(plan.environment.PLANNOTATOR_SERVICE_LABEL).toBe(SERVICE_LABEL);
    expect(plan.port).toBe(4397);
    expect(Object.keys(plan.environment).sort()).toEqual(["PATH", "PLANNOTATOR_SERVICE_LABEL"]);
  });

  test("Given door and port settings in the installing environment, the plist carries exactly those that are set", () => {
    const plan = servicePlan({
      home: "/Users/me",
      cwd: "/work",
      env: { PLANNOTATOR_SERVICE_PORT: "4497", PLANNOTATOR_PUBLIC_PORT: "off", PLANNOTATOR_TEMPORARY_ORIGIN: "https://a.example?x=1&y=<2>", PLANNOTATOR_REVIEWS_DIR: " ", HOME: "/x" },
    });
    expect(plan.port).toBe(4497);
    expect(plan.environment.PLANNOTATOR_PUBLIC_PORT).toBe("off");
    expect(plan.environment.PLANNOTATOR_REVIEWS_DIR).toBeUndefined();
    expect(plan.environment.HOME).toBeUndefined();
    expect(renderPlist(plan)).toContain("<string>https://a.example?x=1&amp;y=&lt;2&gt;</string>");
  });

  test("Given a relative reviews folder, the plist carries it resolved against where install ran", () => {
    const plan = servicePlan({ home: "/Users/me", cwd: "/work", env: { PLANNOTATOR_REVIEWS_DIR: "reviews", PLANNOTATOR_DATA_DIR: "/data" } });
    expect(plan.environment.PLANNOTATOR_REVIEWS_DIR).toBe("/work/reviews");
    expect(plan.environment.PLANNOTATOR_DATA_DIR).toBe("/data");
  });
});

describe("plannotator service install", () => {
  test("Given a run from source, install refuses before it copies or loads anything", async () => {
    const { ctx, calls, lines, plan } = context({ version: undefined });
    expect(await runServiceCommand(["install"], ctx)).toBe(1);
    expect(calls).toEqual([]);
    expect(existsSync(plan.binary)).toBe(false);
    expect(existsSync(plan.plistFile)).toBe(false);
    expect(lines.join("\n")).toContain("bun fork/build-binary.ts");
  });

  test("Given port 0 or a non-number port, install refuses before it copies or loads anything", async () => {
    for (const port of ["0", "abc"]) {
      const { ctx, calls, plan } = context({ env: { PLANNOTATOR_SERVICE_PORT: port } });
      expect(await runServiceCommand(["install"], ctx)).toBe(2);
      expect(calls).toEqual([]);
      expect(existsSync(plan.binary)).toBe(false);
    }
  });

  test("Given a loaded service, install puts the binary in ~/.local/bin and replaces the LaunchAgent", async () => {
    const { ctx, calls, lines, plan } = context();
    expect(await runServiceCommand(["install"], ctx)).toBe(0);
    expect(readFileSync(plan.binary, "utf8")).toBe("built binary");
    expect(readFileSync(plan.plistFile, "utf8")).toBe(renderPlist(plan));
    expect(calls).toEqual([`bootout gui/501/${SERVICE_LABEL}`, `bootstrap gui/501 ${plan.plistFile}`]);
    expect(lines.join("\n")).toContain(`Restarted ${SERVICE_LABEL}`);
  });

  test("Given launchd still unloading the old service, install retries the bootstrap until it loads", async () => {
    let bootstraps = 0;
    const { ctx, calls } = context({
      answer: (args) => (args[0] === "bootstrap" && ++bootstraps < 3 ? { status: 5, stdout: "", stderr: "Input/output error" } : OK),
    });
    expect(await runServiceCommand(["install"], ctx)).toBe(0);
    expect(calls.filter((call) => call.startsWith("bootstrap"))).toHaveLength(3);
  });

  test("Given the restarted service answers with another build, install fails and names what answers", async () => {
    const { ctx, lines } = context({ readHealth: async () => ({ version: "0.27.12-appboypov.af5502f7", major: 1, label: SERVICE_LABEL }) });
    expect(await runServiceCommand(["install"], ctx)).toBe(1);
    expect(lines.at(-1)).toContain("with version 0.27.12-appboypov.af5502f7");
  });

  test("Given another server on the port that launchd does not run, install fails", async () => {
    const { ctx, lines } = context({ readHealth: async () => ({ version: "0.27.23-appboypov.abc", major: 1, label: null }) });
    expect(await runServiceCommand(["install"], ctx)).toBe(1);
    expect(lines.at(-1)).toContain("a server launchd does not run");
  });

  test("Given the old process still answers while launchd replaces it, install waits for the new build", async () => {
    const answers = [
      { version: "0.27.12-appboypov.af5502f7", major: 1, label: SERVICE_LABEL },
      { version: "0.27.23-appboypov.abc", major: 1, label: SERVICE_LABEL },
    ];
    const { ctx } = context({ readHealth: async (_port, _timeout, accept) => answers.find(accept) ?? answers.at(-1)! });
    expect(await runServiceCommand(["install"], ctx)).toBe(0);
  });
});

describe("plannotator service uninstall and status", () => {
  test("Given an installed service, uninstall unloads it and removes the plist but keeps the binary", async () => {
    const { ctx, plan } = context();
    await runServiceCommand(["install"], ctx);
    expect(await runServiceCommand(["uninstall"], ctx)).toBe(0);
    expect(existsSync(plan.plistFile)).toBe(false);
    expect(existsSync(plan.binary)).toBe(true);
  });

  test("Given launchd fails to unload a loaded service, uninstall fails and keeps the plist", async () => {
    let failing = false;
    const { ctx, plan } = context({ answer: (args) => (failing && args[0] === "bootout" ? { status: 5, stdout: "", stderr: "Input/output error" } : OK) });
    await runServiceCommand(["install"], ctx);
    failing = true;
    expect(await runServiceCommand(["uninstall"], ctx)).toBe(1);
    expect(existsSync(plan.plistFile)).toBe(true);
  });

  test("Given launchd runs the service and it answers as the LaunchAgent, status succeeds", async () => {
    const { ctx, lines } = context({ answer: () => ({ status: 0, stdout: "\tstate = running\n\tpid = 4242\n", stderr: "" }) });
    expect(await runServiceCommand(["status"], ctx)).toBe(0);
    expect(lines).toContain("launchd: running (pid 4242)");
  });

  test("Given a service installed on another port, status asks that port whatever this shell's environment says", async () => {
    const asked: number[] = [];
    const { ctx } = context({
      env: { PLANNOTATOR_SERVICE_PORT: "4497" },
      answer: () => ({ status: 0, stdout: "\tstate = running\n", stderr: "" }),
      readHealth: async (port) => (asked.push(port), { version: "0.27.23-appboypov.abc", major: 1, label: SERVICE_LABEL }),
    });
    await runServiceCommand(["install"], ctx);
    expect(await runServiceCommand(["status"], { ...ctx, env: {} })).toBe(0);
    expect(asked).toEqual([4497, 4497]);
  });

  test("Given the service is not loaded, status fails without asking for health", async () => {
    let asked = false;
    const { ctx, lines } = context({ answer: () => ({ status: 113, stdout: "", stderr: "not found" }), readHealth: async () => ((asked = true), null) });
    expect(await runServiceCommand(["status"], ctx)).toBe(1);
    expect(asked).toBe(false);
    expect(lines).toContain("launchd: not loaded");
  });

  test("Given an unknown action or another platform, nothing is touched", async () => {
    const { ctx, calls } = context();
    expect(await runServiceCommand(["restart"], ctx)).toBe(2);
    expect(await runServiceCommand(["install"], { ...ctx, platform: "linux" })).toBe(1);
    expect(calls).toEqual([]);
  });
});
