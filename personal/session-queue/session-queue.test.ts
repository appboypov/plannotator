import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

const directories: string[] = [];
const children: ReturnType<typeof Bun.spawn>[] = [];
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null) child.kill("SIGKILL");
    await child.exited;
  }
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "plannotator-queue-test-"));
  directories.push(dir);
  const worker = join(dir, "worker.ts");
  writeFileSync(worker, `
    import { waitForSessionTurn } from ${JSON.stringify(join(import.meta.dir, "index.ts"))};
    await waitForSessionTurn(process.argv[2], "test-project");
    console.log(process.argv[2]);
    await Bun.stdin.text();
    process.exit(0);
  `);
  const start = (label: string) => {
    const child = Bun.spawn([process.execPath, worker, label], {
      env: { ...process.env, PLANNOTATOR_DATA_DIR: dir },
      stdin: "pipe", stdout: "pipe", stderr: "pipe",
    });
    children.push(child);
    return child;
  };
  return { dir, start };
}

async function until(check: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Queue did not reach the expected state");
    await Bun.sleep(25);
  }
}

function rows(dir: string): { label: string; state: string }[] {
  try {
    const db = new Database(join(dir, "session-queue.sqlite"), { readonly: true });
    try {
      return db.query<{ label: string; state: string }, []>("SELECT label, state FROM requests ORDER BY id").all();
    } finally { db.close(); }
  } catch { return []; }
}

function finish(child: ReturnType<ReturnType<typeof setup>["start"]>) {
  if (typeof child.stdin !== "number") child.stdin?.end();
}

test("independent commands wait in order and receive only their own result", async () => {
  const { dir, start } = setup();
  const a = start("A");
  await until(() => rows(dir)[0]?.state === "active");
  const b = start("B");
  await until(() => rows(dir).length === 2);
  const c = start("C");
  await until(() => rows(dir).length === 3);
  expect(rows(dir).map((row) => row.state)).toEqual(["active", "waiting", "waiting"]);
  expect(b.exitCode).toBeNull();
  finish(a);
  expect(await a.exited).toBe(0);
  await until(() => rows(dir)[0]?.label === "B" && rows(dir)[0]?.state === "active");
  expect(c.exitCode).toBeNull();
  finish(b);
  expect(await b.exited).toBe(0);
  await until(() => rows(dir)[0]?.label === "C" && rows(dir)[0]?.state === "active");
  finish(c);
  expect(await c.exited).toBe(0);
  for (const [child, label] of [[a, "A"], [b, "B"], [c, "C"]] as const) {
    expect(await new Response(child.stdout).text()).toBe(`${label}\n`);
  }
  expect(rows(dir)).toEqual([]);
});

test("simultaneous arrivals claim only one slot and recover after its process is killed", async () => {
  const { dir, start } = setup();
  const commands = [start("A"), start("B"), start("C")];
  await until(() => rows(dir).length === 3 && rows(dir).some((row) => row.state === "active"));
  expect(rows(dir).filter((row) => row.state === "active")).toHaveLength(1);
  const first = rows(dir)[0].label;
  const active = commands[["A", "B", "C"].indexOf(first)];
  active.kill("SIGKILL");
  await active.exited;
  await until(() => rows(dir).length === 2 && rows(dir)[0].state === "active");
  expect(rows(dir).filter((row) => row.state === "active")).toHaveLength(1);
});

test("a terminated waiting caller does not block the next request", async () => {
  const { dir, start } = setup();
  const a = start("A");
  await until(() => rows(dir)[0]?.state === "active");
  const b = start("B");
  await until(() => rows(dir).length === 2);
  const c = start("C");
  await until(() => rows(dir).length === 3);
  b.kill("SIGKILL");
  await b.exited;
  finish(a);
  await a.exited;
  await until(() => rows(dir).length === 1 && rows(dir)[0].label === "C" && rows(dir)[0].state === "active");
});

test("commands wait for a registered session started before the queue existed", async () => {
  const { dir, start } = setup();
  mkdirSync(join(dir, "sessions"));
  const registry = join(dir, "sessions", `${process.pid}.json`);
  writeFileSync(registry, JSON.stringify({
    pid: process.pid, mode: "goal-setup", project: "existing", startedAt: new Date().toISOString(),
  }));
  const command = start("new-command");
  await until(() => rows(dir).length === 1);
  await Bun.sleep(300);
  expect(rows(dir)[0].state).toBe("waiting");
  expect(command.exitCode).toBeNull();
  unlinkSync(registry);
  await until(() => rows(dir)[0].state === "active");
  finish(command);
  expect(await command.exited).toBe(0);
});
