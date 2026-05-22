import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureTradingReady } from "@/lib/polymarket/tradeSetup";

const mocks = vi.hoisted(() => ({
  getDepositWalletStatus: vi.fn(),
  createRelayClient: vi.fn(),
  ensureDepositWalletDeployed: vi.fn(),
  ensureDepositWalletApprovals: vi.fn(),
  ensureDepositWalletConditionalApproval: vi.fn(),
  getPolymarketExchangeConfig: vi.fn(),
  ensureTradingSession: vi.fn(),
}));

vi.mock("@/lib/polymarket/depositWallet", () => ({
  getDepositWalletStatus: mocks.getDepositWalletStatus,
}));

vi.mock("@/lib/polymarket/relayer", () => ({
  createRelayClient: mocks.createRelayClient,
  ensureDepositWalletDeployed: mocks.ensureDepositWalletDeployed,
  ensureDepositWalletApprovals: mocks.ensureDepositWalletApprovals,
  ensureDepositWalletConditionalApproval: mocks.ensureDepositWalletConditionalApproval,
  getPolymarketExchangeConfig: mocks.getPolymarketExchangeConfig,
}));

vi.mock("@/lib/polymarket/tradeService", () => ({
  ensureTradingSession: mocks.ensureTradingSession,
}));

describe("gasless trade setup", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  const walletClient = { account: { address: "0x1234567890abcdef1234567890abcdef12345678" } };
  const publicClient = {};
  const readyAccount = {
    ok: true,
    balance: {
      balance: "100000000",
      allowances: { exchange: "1", conditional: "1" },
    },
  };

  function stubConfig(overrides: Partial<{ builderReady: boolean; gaslessReady: boolean; clobReady: boolean; missingSetupReason: string | null }> = {}) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/api/polymarket/config")) {
          return new Response(
            JSON.stringify({
              ok: true,
              realTradingEnabled: true,
              builderReady: overrides.builderReady ?? true,
              gaslessReady: overrides.gaslessReady ?? true,
              clobReady: overrides.clobReady ?? true,
              missingSetupReason: overrides.missingSetupReason ?? null,
            }),
            { status: 200 },
          );
        }
        if (url.includes("/api/polymarket/auth/status") || url.includes("/api/polymarket/auth/init")) {
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        if (url.includes("/api/polymarket/account")) {
          return new Response(JSON.stringify(readyAccount), { status: 200 });
        }
        if (url.includes("/api/polymarket/balance-allowance/update")) {
          return new Response(JSON.stringify({ ok: true, data: {} }), { status: 200 });
        }
        if (init?.body) {
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );
  }

  it("blocks gasless setup when relayer credentials are missing", async () => {
    stubConfig({
      builderReady: true,
      gaslessReady: false,
      clobReady: true,
      missingSetupReason: "Gasless trading is not configured on server.",
    });
    mocks.getDepositWalletStatus.mockResolvedValue({ depositWallet: "0xdead", initialized: false });

    await expect(
      ensureTradingReady({
        walletClient,
        address: walletClient.account.address as `0x${string}`,
        publicClient,
        side: "Buy",
        tokenId: "111111",
        amount: 4.3,
        price: 0.43,
      }),
    ).rejects.toThrow("Gasless trading is not configured on server.");

    expect(mocks.ensureDepositWalletDeployed).not.toHaveBeenCalled();
  });

  it("deploys the deposit wallet when it is missing", async () => {
    stubConfig();
    mocks.ensureTradingSession.mockResolvedValue(true);
    mocks.getDepositWalletStatus.mockResolvedValue({ depositWallet: "0xdead", initialized: false });
    mocks.createRelayClient.mockReturnValue({ relay: true });
    mocks.ensureDepositWalletDeployed.mockResolvedValue("0xdead");
    mocks.getPolymarketExchangeConfig.mockReturnValue({
      exchange: "0xexchange",
      conditionalTokens: "0xconditional",
      collateral: "0xcollateral",
    });

    const result = await ensureTradingReady({
      walletClient,
      address: walletClient.account.address as `0x${string}`,
      publicClient,
      side: "Buy",
      tokenId: "111111",
      amount: 4.3,
      price: 0.43,
    });

    expect(mocks.ensureDepositWalletDeployed).toHaveBeenCalledTimes(1);
    expect(result.depositWalletAddress).toBe("0xdead");
  });

  it("syncs CLOB balances with signature type 3 when allowances are missing", async () => {
    stubConfig();
    mocks.ensureTradingSession.mockResolvedValue(true);
    mocks.getDepositWalletStatus.mockResolvedValue({ depositWallet: "0xdead", initialized: true });
    mocks.createRelayClient.mockReturnValue({ relay: true });
    mocks.getPolymarketExchangeConfig.mockReturnValue({
      exchange: "0xexchange",
      conditionalTokens: "0xconditional",
      collateral: "0xcollateral",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/api/polymarket/config")) {
          return new Response(JSON.stringify({ ok: true, realTradingEnabled: true, builderReady: true, gaslessReady: true, clobReady: true, missingSetupReason: null }), { status: 200 });
        }
        if (url.includes("/api/polymarket/account")) {
          return new Response(JSON.stringify({ ok: true, balance: { balance: "100000000", allowances: { exchange: "0", conditional: "0" } } }), { status: 200 });
        }
        if (url.includes("/api/polymarket/balance-allowance/update")) {
          const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
          expect(body.signatureType).toBe(3);
          return new Response(JSON.stringify({ ok: true, data: {} }), { status: 200 });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );

    const result = await ensureTradingReady({
      walletClient,
      address: walletClient.account.address as `0x${string}`,
      publicClient,
      side: "Buy",
      tokenId: "111111",
      amount: 4.3,
      price: 0.43,
    });

    expect(result.depositWalletInitialized).toBe(true);
    expect(mocks.ensureDepositWalletApprovals).toHaveBeenCalled();
    expect(mocks.ensureDepositWalletConditionalApproval).toHaveBeenCalled();
  });

  it("reinitializes the session and retries the account load when the api key is stale", async () => {
    stubConfig();
    mocks.ensureTradingSession.mockResolvedValue(true);
    mocks.getDepositWalletStatus.mockResolvedValue({ depositWallet: "0xdead", initialized: true });
    mocks.createRelayClient.mockReturnValue({ relay: true });
    mocks.getPolymarketExchangeConfig.mockReturnValue({
      exchange: "0xexchange",
      conditionalTokens: "0xconditional",
      collateral: "0xcollateral",
    });

    let accountCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/polymarket/config")) {
          return new Response(JSON.stringify({ ok: true, realTradingEnabled: true, builderReady: true, gaslessReady: true, clobReady: true, missingSetupReason: null }), { status: 200 });
        }
        if (url.includes("/api/polymarket/account")) {
          accountCalls += 1;
          if (accountCalls === 1) {
            return new Response(JSON.stringify({ ok: false, code: "AUTH_INVALID_SESSION", error: "Polymarket session expired. Reinitializing trading session." }), { status: 401 });
          }
          return new Response(JSON.stringify({ ok: true, balance: { balance: "100000000", allowances: { exchange: "1", conditional: "1" } } }), { status: 200 });
        }
        if (url.includes("/api/polymarket/auth/status") || url.includes("/api/polymarket/auth/init")) {
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        if (url.includes("/api/polymarket/balance-allowance/update")) {
          return new Response(JSON.stringify({ ok: true, data: {} }), { status: 200 });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );

    const result = await ensureTradingReady({
      walletClient,
      address: walletClient.account.address as `0x${string}`,
      publicClient,
      side: "Buy",
      tokenId: "111111",
      amount: 4.3,
      price: 0.43,
    });

    expect(accountCalls).toBe(2);
    expect(mocks.ensureTradingSession).toHaveBeenCalledTimes(2);
    expect(result.depositWalletAddress).toBe("0xdead");
  });
});
