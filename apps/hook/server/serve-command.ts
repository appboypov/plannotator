/**
 * `plannotator serve` (fork-owned): runs the review service until the process is
 * stopped. Each Review's page is upstream's annotate server with the plan editor
 * page, started for its document the way `plannotator annotate <file> --gate` starts
 * it, minus the browser, the session registry and the blocking decision.
 */
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { startAnnotateServer, type AnnotateServerOptions } from "@plannotator/server/annotate";
import { detectProjectName } from "@plannotator/server/project";
import {
  REVIEWS_DIR_ENV,
  SERVICE_PORT_ENV,
  resolveServiceSettings,
  startReviewService,
  type StartReviewPage,
} from "@plannotator/server/review-service";
import { resolveAnnotateTarget } from "./annotate-resolution";
import { SERVICE_LABEL_ENV } from "./launch-agent";

export const SERVE_USAGE = [
  "Usage:",
  "  plannotator serve [--port <n>]",
  "",
  "Run the always-on review service on 127.0.0.1: one link per document under",
  "/plannotator/session/<review_id>/, the review API under /api/review/, and",
  "/plannotator/health. See docs/review-api.md.",
  "",
  "Options:",
  `  --port <n>    Port on 127.0.0.1 (default 4397, or ${SERVICE_PORT_ENV}); 0 picks a free port`,
  "",
  "Environment:",
  `  ${SERVICE_PORT_ENV}   Port when --port is absent`,
  `  ${REVIEWS_DIR_ENV}    Folder with one folder per Review (default <data dir>/reviews)`,
].join("\n");

/** What every Review's page shares with the plain annotate command. */
export type ServePageDefaults = Pick<
  AnnotateServerOptions,
  "htmlContent" | "origin" | "sharingEnabled" | "shareBaseUrl" | "pasteApiUrl"
>;

/** Starts the service from `serve`'s arguments; returns once it listens. Exits 2 on a bad setting. */
export async function runServeCommand(options: {
  args: readonly string[];
  version: string;
  page: ServePageDefaults;
}): Promise<void> {
  if (options.args.includes("--help") || options.args.includes("-h")) {
    console.log(SERVE_USAGE);
    process.exit(0);
  }
  const settings = resolveServiceSettings(options.args);
  if (!settings.ok) {
    console.error(`${settings.error}\n\n${SERVE_USAGE}`);
    process.exit(2);
  }
  const { port, reviewsDir } = settings.value;

  // Pages are loopback-only and pick free ports: the service is their only door,
  // whatever PLANNOTATOR_REMOTE or PLANNOTATOR_PORT the launching shell carried.
  process.env.PLANNOTATOR_REMOTE = "0";
  delete process.env.PLANNOTATOR_PORT;
  // Upstream servers warm a file list of the working directory; the service's own
  // folder keeps that walk small, wherever the service was started from.
  await mkdir(reviewsDir, { recursive: true });
  process.chdir(reviewsDir);

  const startPage: StartReviewPage = async (review) => {
    const projectRoot = dirname(review.file);
    const resolution = await resolveAnnotateTarget({
      rawFilePath: review.file,
      projectRoot,
      noJina: false,
      renderMarkdown: false,
      log: (line) => console.error(`[plannotator] ${line}`),
    });
    if (!resolution.ok) throw new Error(resolution.message);
    const page = await startAnnotateServer({
      ...options.page,
      markdown: resolution.markdown,
      filePath: resolution.absolutePath,
      mode: resolution.annotateMode,
      folderPath: resolution.folderPath,
      sourceInfo: resolution.sourceInfo,
      sourceConverted: resolution.sourceConverted,
      rawHtml: resolution.rawHtml,
      renderHtml: !!resolution.rawHtml,
      gate: true,
      approvalNotesSupported: true,
      agentCwd: projectRoot,
      project: (await detectProjectName(projectRoot)) ?? "_unknown",
    });
    return { port: page.port, stop: page.stop };
  };

  await startReviewService({
    port,
    reviewsDir,
    version: options.version,
    startPage,
    serviceLabel: process.env[SERVICE_LABEL_ENV]?.trim() || undefined,
  });
}
