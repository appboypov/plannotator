/**
 * `plannotator serve` (fork-owned): runs the review service until the process is
 * stopped. Each Review's page is upstream's annotate or PR code review server,
 * started for its subject with no browser, session registry or blocking decision.
 */
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { startAnnotateServer, type AnnotateServerOptions } from "@plannotator/server/annotate";
import { detectProjectName } from "@plannotator/server/project";
import { startReviewServer } from "@plannotator/server/review";
import { parsePRUrl, checkPRAuth, fetchPR, getMRLabel, getMRNumberLabel, getDisplayRepo } from "@plannotator/server/pr";
import {
  DEFAULT_PUBLIC_HOST,
  DEFAULT_PUBLIC_PEER,
  PUBLIC_HOST_ENV,
  PUBLIC_PEER_ENV,
  PUBLIC_PORT_ENV,
  REVIEWS_DIR_ENV,
  SERVICE_PORT_ENV,
  TEMPORARY_ORIGIN_ENV,
  TEMPORARY_PORT_ENV,
  resolveServiceSettings,
  startReviewService,
  type StartReviewPage,
} from "@plannotator/server/review-service";
import { DEFAULT_TEMPORARY_ORIGIN } from "@plannotator/shared/review-api";
import { resolveAnnotateTarget } from "./annotate-resolution";
import { SERVICE_LABEL_ENV } from "./launch-agent";

export const SERVE_USAGE = [
  "Usage:",
  "  plannotator serve [--port <n>]",
  "",
  "Run the always-on review service on 127.0.0.1: one link per document under",
  "/plannotator/session/<review_id>/, the review API under /api/review/, and",
  "/plannotator/health. Two doors open when their port is set: the public door serves",
  "only public Reviews to the VPS behind ctas.de-appspecialist.nl, the temporary door",
  "only temporary Reviews to ngrok on this Mac. `plannotator service install` sets both",
  "ports; run by hand, serve opens no door. See docs/review-api.md.",
  "",
  "Options:",
  `  --port <n>    Port on 127.0.0.1 (default 4397, or ${SERVICE_PORT_ENV}); 0 picks a free port`,
  "",
  "Environment:",
  `  ${SERVICE_PORT_ENV}       Port when --port is absent`,
  `  ${REVIEWS_DIR_ENV}        Folder with one folder per Review (default <data dir>/reviews)`,
  `  ${PUBLIC_PORT_ENV}        Public door port (installed: 4399); unset or off opens none`,
  `  ${PUBLIC_HOST_ENV}        Public door address (default ${DEFAULT_PUBLIC_HOST})`,
  `  ${PUBLIC_PEER_ENV}        The one address the public door accepts (default ${DEFAULT_PUBLIC_PEER})`,
  `  ${TEMPORARY_PORT_ENV}     Temporary door port on 127.0.0.1, loopback only (installed: 4398); unset or off opens none`,
  `  ${TEMPORARY_ORIGIN_ENV}   Origin of temporary links, the one host the temporary door answers (default ${DEFAULT_TEMPORARY_ORIGIN})`,
  "  PLANNOTATOR_MULTICA_PROFILE  CLI profile for linked Review comments; unset disables linking",
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
  reviewHtmlContent: string;
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
  const { port, reviewsDir, publicDoor, temporaryPort, temporaryOrigin, multicaProfile } = settings.value;

  // Pages are loopback-only and pick free ports: the service is their only door,
  // whatever PLANNOTATOR_REMOTE or PLANNOTATOR_PORT the launching shell carried.
  process.env.PLANNOTATOR_REMOTE = "0";
  delete process.env.PLANNOTATOR_PORT;
  // Upstream servers warm a file list of the working directory; the service's own
  // folder keeps that walk small, wherever the service was started from.
  await mkdir(reviewsDir, { recursive: true });
  process.chdir(reviewsDir);

  const startPage: StartReviewPage = async (review) => {
    const ref = parsePRUrl(review.file);
    if (ref) {
      await checkPRAuth(ref);
      console.error(`[plannotator] fetching ${review.file} for Review ${review.review_id} round ${review.round}`);
      const pr = await fetchPR(ref);
      const page = await startReviewServer({
        rawPatch: pr.rawPatch,
        gitRef: `${getMRLabel(ref)} ${getMRNumberLabel(ref)}`,
        prMetadata: pr.metadata,
        prPatchIncomplete: pr.patchIncomplete ?? false,
        project: getDisplayRepo(ref),
        origin: options.page.origin,
        sharingEnabled: options.page.sharingEnabled,
        shareBaseUrl: options.page.shareBaseUrl,
        approvalNotesSupported: true,
        htmlContent: options.reviewHtmlContent,
      });
      return { port: page.port, stop: page.stop };
    }
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
    publicDoor,
    temporaryPort,
    temporaryOrigin,
    multicaProfile,
    serviceLabel: process.env[SERVICE_LABEL_ENV]?.trim() || undefined,
  });
}
