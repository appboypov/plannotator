export interface UpdateState {
  status: "idle" | "updating" | "current" | "updated" | "conflict" | "failed";
  tag?: string;
  worktree?: string;
  branch?: string;
  files?: string[];
  todo?: string;
  message?: string;
}
