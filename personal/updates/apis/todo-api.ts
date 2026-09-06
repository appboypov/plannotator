import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CommandApi } from "../../core/apis/command-api";
import type { UpdateState } from "../models/update-state";

export class TodoApi {
  constructor(private readonly commands: CommandApi, private readonly team: string) {}
  async create(state: UpdateState, cwd: string): Promise<string> {
    const title = `Resolve Plannotator ${state.tag} update conflicts`;
    const existing = await this.commands.run("linear", ["issue", "query", "--team", this.team, "--search", title, "--all-states", "--json"], cwd);
    const match = JSON.parse(existing.stdout).nodes?.find((issue: {title:string;url:string}) => issue.title === title);
    if (match?.url) return match.url;
    const path = join(cwd, ".git", "personal-update-conflict.md");
    const prompt = `Resolve the Plannotator ${state.tag} import in ${state.worktree} on branch ${state.branch}. Read AGENTS.md and personal/README.md first. Always load /Users/codaveto/Work/skills/our-dev-conventions/SKILL.md and all relevant conventions. Preserve the personal queue and fork updater services. Conflicting files: ${(state.files || []).join(", ")}. Resolve the existing merge in that checkout and stage the resolutions. Do not use git reset, restore, checkout --, stash, or merge --abort. Run make resume from ${cwd}; it validates, builds, fast-forwards and pushes only appboypov/plannotator, then installs the binary. If validation fails, fix it in the retained update checkout and rerun make resume. Do not push to the original project. Mark this todo Done only after the update succeeds.`;
    writeFileSync(path, `## Prompt\n\n${prompt}\n`);
    const result = await this.commands.run("linear", ["issue", "create", "--team", this.team, "--title", title, "--description-file", path, "--state", "Inbox", "--no-interactive"], cwd);
    const url = result.stdout.match(/https:\/\/linear\.app\/\S+/)?.[0];
    if (!url) throw new Error(`Todo creation returned no issue URL: ${result.stdout}`);
    return url;
  }
}
