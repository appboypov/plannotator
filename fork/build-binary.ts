/**
 * Builds this checkout's `plannotator` binary for this machine at `fork/dist/plannotator`:
 * the review and plan pages first, then the compiled CLI, the way upstream's release job
 * builds it (`.github/workflows/release.yml`). The version is the package version with the
 * fork commit, such as `0.27.23-appboypov.da228139`; a checkout with uncommitted changes, or
 * outside git, adds a build stamp (`0.27.23-appboypov.da228139.dirty.mg7x2k1`), so every such
 * build answers with its own version. `plannotator --version` and `/plannotator/health` both print it.
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

/** `appboypov.<commit>`, stamped when the build is not exactly that commit. */
function buildIdentity(): string {
  const stamp = Date.now().toString(36);
  const head = Bun.spawnSync(["git", "rev-parse", "--short=8", "HEAD"], { cwd: root });
  const commit = head.stdout.toString().trim();
  if (head.exitCode !== 0 || !/^[0-9a-f]+$/.test(commit)) return `appboypov.local.${stamp}`;
  // Tracked changes only: an untracked folder beside the code (notes, scratch) does not change the build.
  const status = Bun.spawnSync(["git", "status", "--porcelain", "--untracked-files=no"], { cwd: root });
  return status.exitCode === 0 && status.stdout.toString().trim() === "" ? `appboypov.${commit}` : `appboypov.${commit}.dirty.${stamp}`;
}

if (import.meta.main) {
  const { version: packageVersion } = (await Bun.file(join(root, "package.json")).json()) as { version: string };
  const version = `${packageVersion}-${buildIdentity()}`;
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
