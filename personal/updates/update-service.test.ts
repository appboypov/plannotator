import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CommandApi } from "../core/apis/command-api";
import { UpdateService } from "./services/update-service";
import { UpdateStateApi } from "./apis/update-state-api";
import { forkConfig } from "./config/fork-config";
import type { ReleaseApi } from "./apis/release-api";
import type { TodoApi } from "./apis/todo-api";
import type { BuildService } from "./services/build-service";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
async function fixture(conflict = false) {
  const root = mkdtempSync(join(tmpdir(), "personal-fork-update-test-")); roots.push(root);
  const source = join(root, "source"), origin = join(root, "origin.git"), repo = join(root, "repo");
  mkdirSync(source);
  const commands = new CommandApi();
  const run = (cwd: string, ...args: string[]) => commands.run("git", args, cwd);
  await run(source, "init", "-b", "main");
  await run(source, "config", "user.email", "test@example.invalid");
  await run(source, "config", "user.name", "Test");
  writeFileSync(join(source, "feature.txt"), "base\n");
  await run(source, "add", "."); await run(source, "commit", "-m", "base"); await run(source, "tag", "v1.0.0");
  await run(root, "clone", "--bare", source, origin);
  await run(root, "clone", origin, repo);
  await run(repo, "switch", "-c", "personal");
  await run(repo, "config", "user.email", "test@example.invalid"); await run(repo, "config", "user.name", "Test");
  mkdirSync(join(repo, "personal/updates/config"), { recursive: true });
  writeFileSync(join(repo, "personal/updates/config/upstream.json"), JSON.stringify({tag:"v1.0.0"}));
  if (conflict) writeFileSync(join(repo, "feature.txt"), "personal behaviour\n");
  await run(repo, "add", "."); await run(repo, "commit", "-m", "personal fork"); await run(repo, "push", "-u", "origin", "personal");
  writeFileSync(join(source, "feature.txt"), "release behaviour\n");
  mkdirSync(join(source, ".github/workflows"), { recursive: true });
  writeFileSync(join(source, ".github/workflows/release.yml"), "name: publish\n");
  await run(source, "add", "."); await run(source, "commit", "-m", "release"); await run(source, "tag", "v1.1.0");
  const config = {...forkConfig, root:repo, sourceUrl:source, originUrl:origin, installPath:join(root,"installed")};
  const state = new UpdateStateApi(join(repo, ".git/state.sqlite"));
  const todos: any[] = []; let builds = 0; let failBuild = false;
  const service = new UpdateService(config, commands,
    {latest: async () => ({tag_name:"v1.1.0",html_url:"https://example.invalid/release"})} as unknown as ReleaseApi,
    {create: async (value: unknown) => {todos.push(value);return "https://linear.app/test/issue/BRIAN-1";}} as unknown as TodoApi,
    state,
    {build: async () => {builds++;if(failBuild)throw new Error("test build failure");return "candidate";},install:()=>writeFileSync(config.installPath,"installed")} as unknown as BuildService);
  return {repo,origin,source,run,service,state,todos,config,builds:()=>builds,failBuild:()=>{failBuild=true;}};
}

test("a clean release import strips pipelines, pushes only the fork and installs", async () => {
  const f = await fixture();
  const result = await f.service.update();
  expect(result.status).toBe("updated");
  expect(readFileSync(join(f.repo,"feature.txt"),"utf8")).toBe("release behaviour\n");
  expect(existsSync(join(f.repo,".github/workflows/release.yml"))).toBe(false);
  expect(f.todos).toHaveLength(0);
  expect(existsSync(f.config.installPath)).toBe(true);
  expect((await f.run(f.repo,"remote")).stdout).toBe("origin");
  expect((await f.run(f.repo,"rev-parse","HEAD")).stdout).toBe((await f.run(f.origin,"rev-parse","personal")).stdout);
});

test("a conflict retains the merge, creates one todo and resumes after manual resolution", async () => {
  const f = await fixture(true);
  const result = await f.service.update();
  expect(result.status).toBe("conflict");
  expect(result.files).toEqual(["feature.txt"]);
  expect(f.todos).toHaveLength(1);
  expect(f.builds()).toBe(0);
  expect(existsSync(f.config.installPath)).toBe(false);
  expect((await f.service.update()).status).toBe("conflict");
  expect(f.todos).toHaveLength(1);
  writeFileSync(join(result.worktree!,"feature.txt"),"both behaviours\n");
  await f.run(result.worktree!,"add","feature.txt");
  expect((await f.service.update(true)).status).toBe("updated");
  expect(readFileSync(join(f.repo,"feature.txt"),"utf8")).toBe("both behaviours\n");
});

test("failed builds leave the branch and installed executable unchanged", async () => {
  const f = await fixture(); f.failBuild();
  const before = (await f.run(f.repo,"rev-parse","HEAD")).stdout;
  expect((await f.service.update()).status).toBe("failed");
  expect((await f.run(f.repo,"rev-parse","HEAD")).stdout).toBe(before);
  expect(existsSync(f.config.installPath)).toBe(false);
});

test("the installed update command has readable help", async () => {
  const { formatSubcommandHelp } = await import("../../apps/hook/server/cli");
  expect(typeof formatSubcommandHelp("update")).toBe("string");
});
