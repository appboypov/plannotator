import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { UpdateState } from "../models/update-state";

export class UpdateStateApi {
  constructor(private readonly path: string) {}
  private open() {
    mkdirSync(dirname(this.path), { recursive: true });
    const db = new Database(this.path);
    db.exec("PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY, pid INTEGER, value TEXT NOT NULL)");
    db.query("INSERT OR IGNORE INTO state VALUES (1, NULL, ?)").run(JSON.stringify({ status: "idle" }));
    return db;
  }
  read(): UpdateState {
    const db = this.open();
    try {
      const row = db.query("SELECT pid, value FROM state WHERE id=1").get() as {pid:number|null;value:string};
      const state = JSON.parse(row.value) as UpdateState;
      if (state.status === "updating" && row.pid) {
        try { process.kill(row.pid, 0); } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EPERM") return { ...state, status: "failed", message: "The updater stopped. Inspect the retained checkout and run make resume." };
        }
      }
      return state;
    }
    finally { db.close(); }
  }
  claim(): boolean {
    const db = this.open();
    try { return db.transaction(() => {
      const row = db.query("SELECT pid FROM state WHERE id=1").get() as {pid:number|null};
      if (row.pid) {
        try { process.kill(row.pid, 0); return false; } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EPERM") return false;
        }
      }
      db.query("UPDATE state SET pid=? WHERE id=1").run(process.pid);
      return true;
    }).immediate(); } finally { db.close(); }
  }
  write(value: UpdateState) {
    const db = this.open();
    try { db.query("UPDATE state SET value=? WHERE id=1").run(JSON.stringify(value)); }
    finally { db.close(); }
  }
  release() {
    const db = this.open();
    try { db.query("UPDATE state SET pid=NULL WHERE id=1 AND pid=?").run(process.pid); }
    finally { db.close(); }
  }
}
