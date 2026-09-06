export class CommandApi {
  async run(command: string, args: string[], cwd: string, allowFailure = false) {
    const child = Bun.spawn([command, ...args], {
      cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      stdin: "ignore", stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    if (code && !allowFailure) throw new Error(`${command} ${args[0]} failed (${code}): ${stderr || stdout}`);
    return { stdout: stdout.trim(), stderr: stderr.trim(), code };
  }
}
