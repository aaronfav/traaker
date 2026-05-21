import { describe, expect, it } from "vitest";
import { buildPortfolioSetupSteps, getTradeDisabledReason, isBytes32Hex } from "@/lib/polymarket/readiness";
import type { PortfolioBalanceState } from "@/lib/polymarket/types";

const readyBalance: PortfolioBalanceState = {
  usdc: {
    balance: 125.5,
    rawBalance: "125500000",
    allowances: { exchange: "1", conditional: "1" },
    exchangeAllowance: "1",
    ctfAllowance: "1",
    hasExchangeAllowance: true,
    hasCtfAllowance: true,
  },
  pUsd: null,
  conditional: null,
  source: "polymarket",
};

describe("polymarket readiness", () => {
  it("validates bytes32 builder codes", () => {
    expect(isBytes32Hex("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe(true);
    expect(isBytes32Hex("0x1234")).toBe(false);
    expect(isBytes32Hex("builder")).toBe(false);
  });

  it("builds a checklist that marks deposit wallet and allowances as missing when setup is incomplete", () => {
    const steps = buildPortfolioSetupSteps({
      isConnected: true,
      chainId: 137,
      configReady: true,
      depositWalletInitialized: false,
      balance: {
        ...readyBalance,
        usdc: {
          ...readyBalance.usdc,
          balance: 0,
          exchangeAllowance: null,
          ctfAllowance: null,
          hasExchangeAllowance: false,
          hasCtfAllowance: false,
        },
      },
    });

    expect(steps.find((step) => step.key === "deposit_wallet_initialized")?.ready).toBe(false);
    expect(steps.find((step) => step.key === "exchange_allowance")?.ready).toBe(false);
    expect(steps.find((step) => step.key === "ctf_allowance")?.ready).toBe(false);
    expect(steps.find((step) => step.key === "ready_to_trade")?.ready).toBe(false);
  });

  it("marks the account as ready when every step is complete", () => {
    const steps = buildPortfolioSetupSteps({
      isConnected: true,
      chainId: 137,
      configReady: true,
      depositWalletInitialized: true,
      balance: readyBalance,
    });

    expect(steps.every((step) => step.ready)).toBe(true);
  });

  it("disables live trading when the deposit wallet is missing", () => {
    expect(
      getTradeDisabledReason({
        configReady: true,
        realTradingEnabled: true,
        isConnected: true,
        chainId: 137,
        depositWalletInitialized: false,
        balance: readyBalance,
        quoteFresh: true,
      }),
    ).toBe("Initialize trading wallet.");
  });

  it("disables live trading when allowances are missing", () => {
    const missingAllowance: PortfolioBalanceState = {
      ...readyBalance,
      usdc: {
        ...readyBalance.usdc,
        exchangeAllowance: null,
        hasExchangeAllowance: false,
      },
    };

    expect(
      getTradeDisabledReason({
        configReady: true,
        realTradingEnabled: true,
        isConnected: true,
        chainId: 137,
        depositWalletInitialized: true,
        balance: missingAllowance,
        quoteFresh: true,
      }),
    ).toBe("Approve USDC.");
  });

  it("requires fresh account data before enabling live trading", () => {
    expect(
      getTradeDisabledReason({
        configReady: true,
        realTradingEnabled: true,
        isConnected: true,
        chainId: 137,
        depositWalletInitialized: true,
        balance: null,
        quoteFresh: true,
      }),
    ).toBe("Refresh account data.");
  });

  it("returns null when the account is ready to trade", () => {
    expect(
      getTradeDisabledReason({
        configReady: true,
        realTradingEnabled: true,
        isConnected: true,
        chainId: 137,
        depositWalletInitialized: true,
        balance: readyBalance,
        quoteFresh: true,
      }),
    ).toBeNull();
  });
});
