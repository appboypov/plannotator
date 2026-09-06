export interface QueuedSession {
  id: number;
  pid: number;
  label: string;
  project: string;
  state: "waiting" | "active";
}

