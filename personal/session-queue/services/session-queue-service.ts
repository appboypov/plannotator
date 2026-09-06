import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { listSessions } from "../../../packages/server/sessions";
import type { QueuedSession } from "../models/queued-session";

const POLL_INTERVAL_MS = 250;

function openQueue(dir: string): Database {
  mkdirSync(dir, { recursive: true });
  const db = new Database(join(dir, "session-queue.sqlite"));
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(`CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pid INTEGER NOT NULL,
    label TEXT NOT NULL,
    project TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'waiting'
  )`);
  return db;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function liveRequests(db: Database): QueuedSession[] {
  const rows = db.query<QueuedSession, []>("SELECT * FROM requests ORDER BY id").all();
  return rows.filter((row) => {
    if (isAlive(row.pid)) return true;
    db.query("DELETE FROM requests WHERE id = ?").run(row.id);
    return false;
  });
}

export class SessionQueueService {
  constructor(private readonly dataDir: string) {}

  list(): QueuedSession[] {
    const db = openQueue(this.dataDir);
    try {
      return db.transaction(() => liveRequests(db)).immediate();
    } finally {
      db.close();
    }
  }

  /** Hold the slot until this CLI process exits, including result publication. */
  async wait(label: string, project: string): Promise<void> {
    const db = openQueue(this.dataDir);
    const id = Number(db.query(
      "INSERT INTO requests (pid, label, project) VALUES (?, ?, ?)",
    ).run(process.pid, label, project).lastInsertRowid);
    const release = () => {
      try {
        db.query("DELETE FROM requests WHERE id = ?").run(id);
      } finally {
        db.close();
      }
    };
    process.once("exit", release);

    let previousPosition = -1;
    try {
      while (true) {
        const { position, admitted } = db.transaction(() => {
          const rows = liveRequests(db);
          const index = rows.findIndex((row) => row.id === id);
          // Older binaries have registry entries but no queue row. Leave them running.
          const existing = listSessions().filter((session) => session.pid !== process.pid);
          const admitted = index === 0 && existing.length === 0;
          if (admitted) {
            db.query("UPDATE requests SET state = 'active' WHERE id = ?").run(id);
          }
          const activeAhead = rows.slice(0, index).filter((row) => row.state === "active").length;
          return { position: index + 1 - activeAhead, admitted };
        }).immediate();
        if (admitted) {
          if (previousPosition !== -1) console.error(`[queue] Starting ${label} (request ${id}).`);
          return;
        }
        if (position !== previousPosition) {
          console.error(`[queue] Waiting #${position}: ${label} (request ${id}). The command will continue automatically.`);
          previousPosition = position;
        }
        await Bun.sleep(POLL_INTERVAL_MS);
      }
    } catch (error) {
      process.removeListener("exit", release);
      release();
      throw error;
    }
  }

}
