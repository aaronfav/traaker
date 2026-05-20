import { describe, expect, it } from "vitest";
import { calculateTradeTicket } from "@/components/trading/tradeCalculations";

describe("trade ticket calculations", () => {
  it("calculates market order cost, payout, and slippage", () => {
    const summary = calculateTradeTicket({
      orderType: "market",
      price: 0.62,
      quantity: 10,
      bestAsk: 0.65,
    });

    expect(summary.avgPrice).toBe(0.62);
    expect(summary.cost).toBe(6.2);
    expect(summary.estimatedPayout).toBe(10);
    expect(summary.estimatedProfit).toBe(3.8);
    expect(summary.slippageEstimate).toBeCloseTo(0.03);
  });

  it("uses the limit price for limit orders", () => {
    const summary = calculateTradeTicket({
      orderType: "limit",
      price: 0.62,
      limitPrice: 0.58,
      quantity: 20,
    });

    expect(summary.avgPrice).toBe(0.58);
    expect(summary.cost).toBe(11.6);
    expect(summary.slippageEstimate).toBe(0);
  });
});

