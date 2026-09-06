import { resolve } from "node:path";
import { homedir } from "node:os";

declare const __FORK_REPO__: string;
declare const __FORK_VERSION__: string;
export const forkConfig = {
  repo: "appboypov/plannotator",
  branch: "personal",
  originUrl: "git@github.com:appboypov/plannotator.git",
  source: "backnotprop/plannotator",
  sourceUrl: "https://github.com/backnotprop/plannotator.git",
  root: typeof __FORK_REPO__ !== "undefined" ? __FORK_REPO__ : resolve(import.meta.dir, "../../.."),
  installedVersion: typeof __FORK_VERSION__ !== "undefined" ? __FORK_VERSION__ : "development",
  installPath: resolve(homedir(), ".local/bin/plannotator"),
  todoTeam: "BRIAN",
};
export type ForkConfig = typeof forkConfig;
