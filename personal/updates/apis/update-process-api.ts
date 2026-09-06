import { spawn } from "node:child_process";
import { openSync, closeSync } from "node:fs";
import { join } from "node:path";
export class UpdateProcessApi {
  constructor(private readonly root: string) {}
  start() {
    const fd = openSync(join(this.root, ".git/personal-update.log"), "a");
    try {
      const child = spawn(Bun.which("bun") || "bun", [join(this.root, "personal/updates/commands/cli.ts"), "update"], {
        cwd: this.root, detached: true, stdio: ["ignore", fd, fd],
      });
      child.on("error", (error) => console.error(`[fork] Failed to start updater: ${error.message}`));
      child.unref();
      return child.pid;
    } finally { closeSync(fd); }
  }
}
