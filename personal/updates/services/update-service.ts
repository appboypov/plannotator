import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { CommandApi } from "../../core/apis/command-api";
import type { ForkConfig } from "../config/fork-config";
import type { ReleaseApi } from "../apis/release-api";
import type { TodoApi } from "../apis/todo-api";
import type { UpdateStateApi } from "../apis/update-state-api";
import type { BuildService } from "./build-service";
import type { UpdateState } from "../models/update-state";

export class UpdateService {
  constructor(
    private readonly config: ForkConfig,
    private readonly commands: CommandApi,
    private readonly releases: ReleaseApi,
    private readonly todos: TodoApi,
    private readonly state: UpdateStateApi,
    private readonly builds: BuildService,
  ) {}
  private git(args: string[], cwd = this.config.root, allowFailure = false) {
    return this.commands.run("git", args, cwd, allowFailure);
  }
  async check() {
    const release = await this.releases.latest(this.config.root);
    const base = JSON.parse(readFileSync(join(this.config.root, "personal/updates/config/upstream.json"), "utf8"));
    const currentVersion = this.config.installedVersion === "development"
      ? (await this.commands.run(this.config.installPath, ["--version"], this.config.root)).stdout.replace(/^plannotator /, "")
      : this.config.installedVersion;
    return { currentVersion, latestVersion: release.tag_name,
      updateAvailable: release.tag_name !== base.tag, releaseUrl: release.html_url, state: this.state.read() };
  }
  private async assertCheckout() {
    const remote = await this.git(["remote"]);
    const url = await this.git(["remote", "get-url", "origin"]);
    const pushUrl = await this.git(["remote", "get-url", "--push", "origin"]);
    const allowed = [this.config.originUrl];
    if (remote.stdout !== "origin" || !allowed.includes(url.stdout) || !allowed.includes(pushUrl.stdout)) {
      throw new Error("Only the configured appboypov origin may be used for updates");
    }
    if ((await this.git(["branch", "--show-current"])).stdout !== this.config.branch) throw new Error(`Switch to ${this.config.branch} before updating`);
    if ((await this.git(["status", "--porcelain"])).stdout) throw new Error("Commit the working changes before updating; the installed binary is unchanged");
  }
  private async removePipelines(worktree: string) {
    await this.git(["rm", "-r", "-f", "--ignore-unmatch", ".github/workflows"], worktree);
  }
  private async complete(pending: UpdateState): Promise<UpdateState> {
    const worktree = pending.worktree!;
    await this.removePipelines(worktree);
    const files = (await this.git(["diff", "--name-only", "--diff-filter=U"], worktree)).stdout.split("\n").filter(Boolean);
    if (files.length) {
      const conflict: UpdateState = { ...pending, status: "conflict", files };
      this.state.write(conflict);
      if (!conflict.todo) conflict.todo = await this.todos.create(conflict, this.config.root);
      this.state.write(conflict);
      return conflict;
    }
    const commit = (await this.git(["rev-parse", `refs/upstream-releases/${pending.tag}`])).stdout;
    writeFileSync(join(worktree, "personal/updates/config/upstream.json"), JSON.stringify({ tag: pending.tag, commit }) + "\n");
    await this.git(["add", "-A"], worktree);
    const mergeHead = await this.git(["rev-parse", "-q", "--verify", "MERGE_HEAD"], worktree, true);
    const diff = await this.git(["diff", "--cached", "--quiet"], worktree, true);
    if (mergeHead.code === 0 || diff.code !== 0) await this.git(["commit", "-m", `chore: import Plannotator ${pending.tag}`], worktree);
    const binary = await this.builds.build(worktree);
    await this.assertCheckout();
    // A non-fast-forward push fails if another writer advanced the personal branch.
    await this.git(["push", "origin", `HEAD:refs/heads/${this.config.branch}`], worktree);
    await this.git(["merge", "--ff-only", pending.branch!]);
    this.builds.install(binary);
    const result: UpdateState = { ...pending, status: "updated", files: [], message: "Built, pushed to the personal fork and installed. Existing sessions keep running." };
    this.state.write(result);
    return result;
  }
  async update(resume = false): Promise<UpdateState> {
    if (!this.state.claim()) return { status: "updating", message: "An update is already running" };
    try {
      await this.assertCheckout();
      const previous = this.state.read();
      if (previous.worktree && (previous.status === "conflict" || previous.status === "failed" || previous.status === "updating")) {
        if (!resume) return previous;
        this.state.write({ ...previous, status: "updating" });
        return await this.complete(previous);
      }
      if (resume) throw new Error("There is no retained update to resume");
      this.state.write({ status: "updating" });
      await this.git(["fetch", "origin", this.config.branch]);
      await this.git(["merge", "--ff-only", `origin/${this.config.branch}`]);
      const release = await this.releases.latest(this.config.root);
      const base = JSON.parse(readFileSync(join(this.config.root, "personal/updates/config/upstream.json"), "utf8"));
      if (base.tag === release.tag_name) {
        // Rebuild also picks up personal changes pulled from origin.
        const binary = await this.builds.build(this.config.root);
        this.builds.install(binary);
        const result: UpdateState = { status: "current", tag: base.tag, message: "Latest release and personal changes built and installed" };
        this.state.write(result);
        return result;
      }
      const tag = release.tag_name;
      await this.git(["fetch", "--no-tags", this.config.sourceUrl, `refs/tags/${tag}:refs/upstream-releases/${tag}`]);
      const branch = `updates/${tag}`;
      const worktree = join(this.config.root, ".git", "personal-updates", tag);
      if (existsSync(worktree)) throw new Error(`Retained update already exists at ${worktree}; inspect it before retrying`);
      await this.git(["worktree", "add", "-b", branch, worktree, this.config.branch]);
      const pending: UpdateState = { status: "updating", tag, worktree, branch };
      this.state.write(pending);
      const merge = await this.git(["merge", "--no-ff", "--no-commit", `refs/upstream-releases/${tag}`], worktree, true);
      if (merge.code && !(await this.git(["diff", "--name-only", "--diff-filter=U"], worktree)).stdout) throw new Error(merge.stderr || merge.stdout);
      return await this.complete(pending);
    } catch (error) {
      const failed: UpdateState = { ...this.state.read(), status: "failed", message: error instanceof Error ? error.message : String(error) };
      this.state.write(failed);
      console.error(`[fork] ${failed.message}`);
      return failed;
    } finally { this.state.release(); }
  }
}
