import { canonicalPRSubject } from "@plannotator/shared/review-api/subject";
import type { Origin } from "@plannotator/shared/agents";
import { handleReviewServerReady } from "@plannotator/server/review";
import { resolveServicePort } from "@plannotator/server/review-service";
import { annotateThroughService, type ServiceAnnotateOptions } from "./annotate-service";
import { buildReviewOutput, type ReviewOutput } from "./review-output";

/** Only a PR URL and the output flag select the service; mode flags keep upstream's server. */
export function reviewsThroughService(args: readonly string[]): boolean {
  const targets = args.filter((arg) => arg !== "--json");
  return targets.length === 1 && canonicalPRSubject(targets[0]!) !== undefined;
}

/** The shared Round transport with upstream's code-review output contract. */
export async function reviewThroughService(options: ServiceAnnotateOptions & { origin?: Origin }): Promise<
  { ok: true; output: ReviewOutput } | { ok: false; error: string }
> {
  const result = await annotateThroughService({ ...options, command: "review" });
  if (!result.ok) return result;
  return { ok: true, output: buildReviewOutput({
    approved: result.outcome.approved === true,
    feedback: result.outcome.feedback,
    exit: result.outcome.exit,
    annotations: result.annotations ?? [],
  }, options.origin) };
}

/** Prints the service link, opens the local page and waits for its Round. */
export async function runServiceReviewCommand(options: { file: string; json: boolean; origin: Origin }): Promise<never> {
  const port = resolveServicePort();
  if (!port.ok) {
    console.error(port.error);
    process.exit(1);
  }
  const result = await reviewThroughService({
    file: options.file,
    port: port.value,
    origin: options.origin,
    onOpened: (review) => {
      process.stderr.write(`\nPlannotator review, round ${review.round}:\n${review.link}\n`);
      handleReviewServerReady(review.link, false, port.value);
    },
    log: (line) => console.error(`[plannotator] ${line}`),
  });
  if (!result.ok) {
    console.error(result.error);
    process.exit(1);
  }
  console.log(options.json ? JSON.stringify(result.output) : result.output.message);
  process.exit(0);
}
