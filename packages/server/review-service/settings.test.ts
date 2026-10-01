import { describe, expect, test } from "bun:test";
import { resolveServicePort } from "./settings";

describe("resolveServicePort, the port a client of the service calls", () => {
  test("PLANNOTATOR_SERVICE_PORT, else 4397", () => {
    expect(resolveServicePort({ PLANNOTATOR_SERVICE_PORT: "4517" })).toEqual({ ok: true, value: 4517 });
    expect(resolveServicePort({ PLANNOTATOR_SERVICE_PORT: " " })).toEqual({ ok: true, value: 4397 });
    expect(resolveServicePort({})).toEqual({ ok: true, value: 4397 });
  });

  test("0 is refused: serve picks a free port with it, which no client can find", () => {
    expect(resolveServicePort({ PLANNOTATOR_SERVICE_PORT: "0" }).ok).toBe(false);
  });

  test("a port that is not one is refused", () => {
    expect(resolveServicePort({ PLANNOTATOR_SERVICE_PORT: "4397x" }).ok).toBe(false);
    expect(resolveServicePort({ PLANNOTATOR_SERVICE_PORT: "65536" }).ok).toBe(false);
  });
});
