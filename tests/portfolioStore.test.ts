import { describe, expect, it } from "vitest";
import { aggregateExposure, calculateUnrealizedPnl, type PortfolioPosition } from "@/app/store/portfolioStore";

describe("portfolio helpers", () => {
  it("calculates unrealized pnl", () => {
    expect(calculateUnrealizedPnl({ shares: 12, avgPrice: 0.4, markPrice: 0.55 })).toBeCloseTo(1.8);
  });

  it("aggregates market exposure", () => {
    const positions: PortfolioPosition[] = [
      { id: "1", marketId: "m1", conditionId: "c1", outcome: "YES", shares: 10, avgPrice: 0.4, markPrice: 0.55 },
      { id: "2", marketId: "m1", conditionId: "c1", outcome: "NO", shares: 5, avgPrice: 0.3, markPrice: 0.2 },
    ];

    expect(aggregateExposure(positions)).toEqual([
      {
        marketId: "m1",
        grossShares: 15,
        grossCost: 5.5,
        markValue: 6.5,
        unrealizedPnl: 1,
      },
    ]);
  });
});

