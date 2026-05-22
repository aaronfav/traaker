import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const routeFiles = [
  "app/api/polymarket/auth/init/route.ts",
  "app/api/polymarket/auth/status/route.ts",
  "app/api/polymarket/account/route.ts",
  "app/api/polymarket/order/route.ts",
  "app/api/polymarket/submit/route.ts",
  "app/api/polymarket/balance-allowance/update/route.ts",
];

describe("polymarket route region config", () => {
  it("matches Polybet by avoiding per-route preferredRegion overrides", () => {
    for (const file of routeFiles) {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(source).not.toMatch(/preferredRegion/);
      expect(source).toMatch(/runtime\s*=\s*["']nodejs["']/);
    }
  });

  it("keeps Vercel config free of region pinning for Polymarket routes", () => {
    const vercel = readFileSync(resolve(process.cwd(), "vercel.json"), "utf8");
    expect(vercel).not.toMatch(/preferredRegion|regions/);
  });
});
