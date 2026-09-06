import type { UpdateState } from "./update-state";
export interface FeatureHighlight { title: string; description: string; }
export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  dismissed: boolean;
  releaseUrl: string;
  featureHighlight?: FeatureHighlight;
  state: UpdateState;
  dismiss: () => void;
  update: () => Promise<void>;
}
