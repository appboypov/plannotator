import { basename } from "node:path";
import { getPlannotatorDataDir } from "../../packages/shared/data-dir";
import { SessionQueueService } from "./services/session-queue-service";
import { startPlannotatorServer as startPlan } from "../../packages/server/index";
import { startReviewServer as startReview } from "../../packages/server/review";
import { startAnnotateServer as startAnnotate } from "../../packages/server/annotate";
import { startGoalSetupServer as startGoal } from "../../packages/server/goal-setup";

const queue = new SessionQueueService(getPlannotatorDataDir());
export const waitForSessionTurn = (label: string, project: string) => queue.wait(label, project);
export const listQueuedSessions = () => queue.list();

function queued<T extends (...args: any[]) => Promise<any>>(start: T, label: string) {
  return async (...args: Parameters<T>): Promise<Awaited<ReturnType<T>>> => {
    await queue.wait(label, basename(process.cwd()));
    return start(...args);
  };
}
export const startPlannotatorServer = queued(startPlan, "plan");
export const startReviewServer = queued(startReview, "review");
export const startAnnotateServer = queued(startAnnotate, "annotate");
export const startGoalSetupServer = queued(startGoal, "goal-setup");
