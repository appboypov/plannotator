/**
 * Builds this checkout's `plannotator` binary for this machine at `fork/dist/plannotator`:
 * the review and plan pages first, then the compiled CLI, the way upstream's release job
 * builds it (`.github/workflows/release.yml`). The version is the package version with the
 * fork commit, such as `0.27.23-appboypov.da228139`; `plannotator --version` and
 * `/plannotator/health` both print it.
 *
 *   bun fork/build-binary.ts && fork/dist/plannotator service install
 */
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const outfile = join(root, "fork", "dist", "plannotator");

async function run(command: string[]): Promise<void> {
  console.log(`$ ${command.join(" ")}`);
  const code = await Bun.spawn(command, { cwd: root, stdio: ["inherit", "inherit", "inherit"] }).exited;
  if (code !== 0) {
    console.error(`Stopped: \`${command.join(" ")}\` exited with ${code}.`);
    process.exit(1);
  }
}

/** The package version with the checkout's commit, so a build names the fork commit it came from. */
function forkVersion(packageVersion: string, commit: string | null): string {
  return commit ? `${packageVersion}-appboypov.${commit}` : packageVersion;
}

function headCommit(): string | null {
  const result = Bun.spawnSync(["git", "rev-parse", "--short=8", "HEAD"], { cwd: root });
  const commit = result.stdout.toString().trim();
  return result.exitCode === 0 && /^[0-9a-f]+$/.test(commit) ? commit : null;
}

if (import.meta.main) {
  const { version: packageVersion } = (await Bun.file(join(root, "package.json")).json()) as { version: string };
  const version = forkVersion(packageVersion, headCommit());
  await run(["bun", "run", "build:review"]);
  await run(["bun", "run", "build:hook"]);
  await run([
    "bun",
    "build",
    "apps/hook/server/index.ts",
    "--compile",
    "--no-compile-autoload-bunfig",
    "--define",
    `__CLI_VERSION__=${JSON.stringify(version)}`,
    "--outfile",
    outfile,
  ]);
  console.log(`Built plannotator ${version} at ${outfile}`);
}
