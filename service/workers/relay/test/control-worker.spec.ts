import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import control, { ROUTES, match } from "../../control/src/index";

const files = Object.keys(import.meta.glob("../../../functions/api/**/*.ts"));
const context = { waitUntil: () => undefined, passThroughOnException: () => undefined } as never;
const ask = (path: string, init?: RequestInit) =>
  control.fetch(new Request(`https://control.test${path}`, init), { CONTROL: env.CONTROL }, context);

describe("the control plane as a Worker", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.CONTROL, env.TEST_MIGRATIONS);
  });

  it("routes every handler file, as Pages would from the file tree", () => {
    const expected = files
      .map((file) => file.replace(/^.*\/functions/, "").replace(/\.ts$/, "").replace(/\/index$/, ""))
      .sort();
    expect(expected.length).toBeGreaterThan(30);
    expect(ROUTES.map(([pattern]) => pattern).sort()).toEqual(expected);
    for (const [, module] of ROUTES) {
      expect(Boolean(module.onRequestGet || module.onRequestPost)).toBe(true);
    }
  });

  it("matches fixed and dynamic segments, and nothing else", () => {
    expect(match("/api/device/orgs")?.params).toEqual({});
    expect(match("/api/device/orgs/")?.params).toEqual({});
    expect(match("/api/device/orgs/invite")?.module).not.toBe(match("/api/device/orgs")?.module);
    expect(match("/api/roads/abc-123/revoke")?.params).toEqual({ id: "abc-123" });
    expect(match("/api/roads/a%20b/revoke")?.params).toEqual({ id: "a b" });
    expect(match("/api/roads/a/b/revoke")).toBeNull();
    expect(match("/api/roads/%E0%A4%A/revoke")).toBeNull();
    expect(match("/api/device/orgsx")).toBeNull();
    expect(match("/api")).toBeNull();
    expect(match("/")).toBeNull();
  });

  it("answers through the real handlers", async () => {
    const roots = await ask("/api/key-transparency/roots");
    expect(roots.status).toBe(404);
    expect(await roots.json()).toEqual({ error: "key_transparency_root_not_available" });

    const head = await ask("/api/key-transparency/roots", { method: "HEAD" });
    expect(head.status).toBe(404);
    expect(await head.text()).toBe("");

    const missing = await ask("/app");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "not_found" });

    const wrong = await ask("/api/device/enroll", { method: "DELETE" });
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get("allow")).toContain("POST");

    const refused = await ask("/api/device/enroll", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect(refused.status).toBeLessThan(500);
  });
});
