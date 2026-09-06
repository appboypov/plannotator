import type { CommandApi } from "../../core/apis/command-api";
export class ReleaseApi {
  constructor(private readonly commands: CommandApi, private readonly source: string) {}
  async latest(cwd: string): Promise<{tag_name: string; html_url: string}> {
    const result = await this.commands.run("gh", ["api", `repos/${this.source}/releases/latest`], cwd);
    const release = JSON.parse(result.stdout);
    if (!/^v\d+\.\d+\.\d+$/.test(release.tag_name)) throw new Error("Latest release has an unsupported version tag");
    return release;
  }
}
