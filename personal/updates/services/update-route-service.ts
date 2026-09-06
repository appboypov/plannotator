import type { UpdateService } from "./update-service";
import type { UpdateStateApi } from "../apis/update-state-api";
import type { UpdateProcessApi } from "../apis/update-process-api";
export class UpdateRouteService {
  constructor(private readonly updates: UpdateService, private readonly state: UpdateStateApi, private readonly process: UpdateProcessApi) {}
  async handle(req: Request): Promise<Response | null> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/personal-update")) return null;
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return Response.json({ error: "Local update only" }, { status: 403 });
    try {
      if (req.method === "GET" && url.pathname === "/api/personal-update/check") return Response.json(await this.updates.check());
      if (req.method === "GET" && url.pathname === "/api/personal-update/status") return Response.json(this.state.read());
      if (req.method === "POST" && url.pathname === "/api/personal-update") {
        if (req.headers.get("origin") !== url.origin || !req.headers.get("content-type")?.startsWith("application/json")) return Response.json({ error: "Same-origin JSON request required" }, { status: 403 });
        const pid = this.process.start();
        if (!pid) throw new Error("Updater did not start");
        return Response.json({ status: "updating", pid }, { status: 202 });
      }
      return Response.json({ error: "Unknown update operation" }, { status: 404 });
    } catch (error) {
      console.error(`[fork] Update request failed: ${error instanceof Error ? error.message : error}`);
      return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
    }
  }
}
