export class UpdateBrowserApi {
  async check() { return this.request("/check"); }
  async status() { return this.request("/status"); }
  async start() { return this.request("", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); }
  private async request(path: string, options?: RequestInit) {
    const response = await fetch(`/api/personal-update${path}`, options);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Update request failed");
    return body;
  }
}
