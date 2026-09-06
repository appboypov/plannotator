import { chmodSync, copyFileSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CommandApi } from "../../core/apis/command-api";
import type { ForkConfig } from "../config/fork-config";

export class BuildService {
  constructor(private readonly commands: CommandApi, private readonly config: ForkConfig) {}
  async build(root: string): Promise<string> {
    console.error(`[fork] Testing and building ${root}`);
    await this.commands.run("bun", ["install", "--frozen-lockfile"], root);
    await this.commands.run("bun", ["install", "--cwd", "personal", "--frozen-lockfile"], root);
    await this.commands.run("bun", ["test", "personal"], root);
    await this.commands.run("bun", ["test", "apps/hook/server/cli.test.ts", "apps/hook/server/annotate-command.test.ts", "apps/hook/server/strict-annotate-result.test.ts", "apps/hook/server/annotate-output.test.ts"], root);
    await this.commands.run("bunx", ["tsc", "--noEmit", "-p", "personal/tsconfig.json"], root);
    await this.commands.run("bun", ["run", "build:review"], root);
    await this.commands.run("bun", ["run", "build:hook"], root);
    const upstream = JSON.parse(readFileSync(join(root, "personal/updates/config/upstream.json"), "utf8"));
    const commit = (await this.commands.run("git", ["rev-parse", "--short", "HEAD"], root)).stdout;
    const version = `${upstream.tag.replace(/^v/, "")}-appboypov.${commit}`;
    const output = join(root, "personal/build/plannotator");
    mkdirSync(dirname(output), { recursive: true });
    await this.commands.run("bun", ["build", "apps/hook/server/index.ts", "--compile", "--define", `__CLI_VERSION__=${JSON.stringify(version)}`, "--define", `__FORK_VERSION__=${JSON.stringify(version)}`, "--define", `__FORK_REPO__=${JSON.stringify(this.config.root)}`, "--outfile", output], root);
    return output;
  }
  install(binary: string) {
    mkdirSync(dirname(this.config.installPath), { recursive: true });
    const next = `${this.config.installPath}.next-${process.pid}`;
    copyFileSync(binary, next);
    chmodSync(next, 0o755);
    renameSync(next, this.config.installPath);
  }
}
