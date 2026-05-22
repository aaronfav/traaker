import { describe, expect, it } from "vitest";
import { validateTrade } from "@/lib/polymarket/validation";

const baseOrder = {
  walletConnected: true,
  chainId: 137,
  tokenID: "123456789",
  amount: 10,
  price: 0.55,
  slippageBps: 1300,
  availableBalance: 25,
  builderCode: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
};

describe("validateTrade", () => {
  it("accepts a valid Polygon order", () => {
    expect(validateTrade(baseOrder).ok).toBe(true);
  });

  it("rejects wrong chain and insufficient balance", () => {
    const result = validateTrade({ ...baseOrder, chainId: 1, availableBalance: 1 });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("Switch to Polygon mainnet before trading.");
  });

  it("rejects malformed builder code", () => {
    const result = validateTrade({ ...baseOrder, builderCode: "builder" });
    expect(result.ok).toBe(false);
  });

  it("rejects slippage above the bounded market limit", () => {
    const result = validateTrade({ ...baseOrder, slippageBps: 1301 });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("Slippage cannot exceed 13%.");
  });
});
