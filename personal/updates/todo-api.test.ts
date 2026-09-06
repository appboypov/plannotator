import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TodoApi } from "./apis/todo-api";
import type { CommandApi } from "../core/apis/command-api";

test("conflict todo uses Brian's board and contains an exact recovery prompt", async () => {
  const root = mkdtempSync(join(tmpdir(), "plannotator-todo-test-"));
  mkdirSync(join(root, ".git"));
  const calls: string[][] = [];
  const api = new TodoApi({ run: async (_command: string, args: string[]) => {
    calls.push(args);
    return { code:0,stderr:"",stdout:args[1] === "query" ? '{"nodes":[]}' : "Created https://linear.app/test/issue/BRIAN-42" };
  }} as unknown as CommandApi, "BRIAN");
  try {
    expect(await api.create({ status:"conflict",tag:"v1.2.3",branch:"updates/v1.2.3",worktree:"/tmp/exact-checkout",files:["packages/server/example.ts"] },root)).toBe("https://linear.app/test/issue/BRIAN-42");
    const text=readFileSync(join(root,".git/personal-update-conflict.md"),"utf8");
    for(const expected of ["/tmp/exact-checkout","updates/v1.2.3","packages/server/example.ts","make resume","our-dev-conventions"]) expect(text).toContain(expected);
    expect(calls[1]).toContain("BRIAN");
    expect(calls[1]).toContain("--description-file");
  } finally {rmSync(root,{recursive:true,force:true});}
});
