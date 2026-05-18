import { describe, expect, it } from "vitest";
import { liquidityScore, opportunityScore, spreadScore, volumeAcceleration } from "@/lib/analytics/scoring";

describe("analytics scoring", () => {
  it("scores higher liquidity above lower liquidity", () => {
    expect(liquidityScore(500_000)).toBeGreaterThan(liquidityScore(2_000));
  });

  it("rewards tighter spreads", () => {
    expect(spreadScore(0.01)).toBeGreaterThan(spreadScore(0.08));
  });

  it("calculates volume acceleration against weekly baseline", () => {
    expect(volumeAcceleration(200, 700)).toBe(2);
  });

  it("produces a bounded opportunity score", () => {
    const score = opportunityScore({
      liquidity: 100_000,
      volume: 250_000,
      priceMove24h: 0.04,
      recentTrades: 100,
      spread: 0.02,
      volumeAcceleration: 1.5,
    });

    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});
