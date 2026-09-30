/**
 * Fork check: runs the `run` steps of upstream's `test` job from
 * .github/workflows/test.yml, in order, the way GitHub's Linux runner does.
 * GitHub Actions is off for this fork; Crabbox runs this (`crabbox job run check`).
 * See fork/README.md and adr/0003-fork-owned-code-and-checks.md.
 */
import { resolve } from "node:path";

const WORKFLOW = ".github/workflows/test.yml";
const JOB = "test";

interface Step {
  name?: string;
  uses?: string;
  run?: string;
}

const repoRoot = resolve(import.meta.dir, "..");
const workflow = Bun.YAML.parse(await Bun.file(resolve(repoRoot, WORKFLOW)).text()) as {
  jobs?: Record<string, { steps?: Step[] }>;
};
const steps = workflow.jobs?.[JOB]?.steps;
if (!steps?.length) {
  console.error(`fork check: job "${JOB}" with steps not found in ${WORKFLOW}`);
  process.exit(1);
}

const runSteps = steps.filter((step): step is Step & { run: string } => typeof step.run === "string");
for (const [index, step] of runSteps.entries()) {
  const label = step.name ?? step.run.split("\n")[0];
  console.log(`\n=== fork check ${index + 1}/${runSteps.length}: ${label}`);
  const result = Bun.spawnSync(["bash", "--noprofile", "--norc", "-eo", "pipefail", "-c", step.run], {
    cwd: repoRoot,
    env: { ...process.env, CI: "true" },
    stdio: ["inherit", "inherit", "inherit"],
  });
  if (result.exitCode !== 0) {
    console.error(`\nfork check: step failed (exit ${result.exitCode}): ${label}`);
    process.exit(result.exitCode ?? 1);
  }
}
console.log(`\nfork check: all ${runSteps.length} steps passed`);
