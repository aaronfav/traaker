import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureTradingReady } from "@/lib/polymarket/tradeSetup";

const mocks = vi.hoisted(() => ({
  getDepositWalletStatus: vi.fn(),
  createRelayClient: vi.fn(),
  loadStoredProxyAddress: vi.fn(),
  storeProxyAddress: vi.fn(),
  ensureDepositWalletDeployed: vi.fn(),
  ensureDepositWalletApprovals: vi.fn(),
  ensureDepositWalletConditionalApproval: vi.fn(),
  ensureApprovals: vi.fn(),
  ensureOperatorApproval: vi.fn(),
  getPolymarketExchangeConfig: vi.fn(),
  ensureTradingSession: vi.fn(),
}));

vi.mock("@/lib/polymarket/depositWallet", () => ({
  getDepositWalletStatus: mocks.getDepositWalletStatus,
}));

vi.mock("@/lib/polymarket/relayer", () => ({
  createRelayClient: mocks.createRelayClient,
  loadStoredProxyAddress: mocks.loadStoredProxyAddress,
  storeProxyAddress: mocks.storeProxyAddress,
  ensureDepositWalletDeployed: mocks.ensureDepositWalletDeployed,
  ensureDepositWalletApprovals: mocks.ensureDepositWalletApprovals,
  ensureDepositWalletConditionalApproval: mocks.ensureDepositWalletConditionalApproval,
  ensureApprovals: mocks.ensureApprovals,
  ensureOperatorApproval: mocks.ensureOperatorApproval,
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
    if (typeof window !== "undefined") {
      window.localStorage.clear();
    }
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

  function stubRelayClient(overrides: Partial<{ expectedSafe: string; proxyDeployed: boolean; depositWalletAddress: string; depositWalletDeployed: boolean }> = {}) {
    const relayClient = {
      getExpectedSafe: vi.fn(async () => overrides.expectedSafe ?? "0xsafe"),
      getDeployed: vi.fn(async (address: string, type?: string) => {
        if (type === "WALLET") return overrides.depositWalletDeployed ?? false;
        if (address.toLowerCase() === (overrides.expectedSafe ?? "0xsafe").toLowerCase()) {
          return overrides.proxyDeployed ?? false;
        }
        return false;
      }),
      deriveDepositWalletAddress: vi.fn(async () => overrides.depositWalletAddress ?? "0xdead"),
    };
    mocks.createRelayClient.mockReturnValue(relayClient as never);
    return relayClient;
  }

  it("blocks gasless setup when relayer credentials are missing", async () => {
    stubConfig({
      builderReady: true,
      gaslessReady: false,
      clobReady: true,
      missingSetupReason: "Gasless trading is not configured on server.",
    });
    stubRelayClient({ expectedSafe: "0xsafe", proxyDeployed: false, depositWalletAddress: "0xdead", depositWalletDeployed: false });
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
    stubRelayClient({ expectedSafe: "0xsafe", proxyDeployed: false, depositWalletAddress: "0xdead", depositWalletDeployed: false });
    mocks.ensureTradingSession.mockResolvedValue(true);
    mocks.getDepositWalletStatus.mockResolvedValue({ depositWallet: "0xdead", initialized: false });
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
    expect(result.signatureType).toBe(3);
  });

  it("syncs CLOB balances with signature type 3 when allowances are missing", async () => {
    stubConfig();
    stubRelayClient({ expectedSafe: "0xsafe", proxyDeployed: false, depositWalletAddress: "0xdead", depositWalletDeployed: false });
    mocks.ensureTradingSession.mockResolvedValue(true);
    mocks.getDepositWalletStatus.mockResolvedValue({ depositWallet: "0xdead", initialized: true });
    mocks.getPolymarketExchangeConfig.mockReturnValue({
      exchange: "0xexchange",
      conditionalTokens: "0xconditional",
      collateral: "0xcollateral",
    });
    const assetTypes: string[] = [];
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
          assetTypes.push(String(body.assetType));
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
    expect(assetTypes).toEqual(expect.arrayContaining(["COLLATERAL", "CONDITIONAL"]));
    expect(mocks.ensureDepositWalletApprovals).toHaveBeenCalled();
    expect(mocks.ensureDepositWalletConditionalApproval).toHaveBeenCalled();
  });

  it("keeps existing proxy/Safe wallets on signature type 2", async () => {
    stubConfig();
    stubRelayClient({ expectedSafe: "0xsafe", proxyDeployed: true, depositWalletAddress: "0xdead", depositWalletDeployed: false });
    mocks.ensureTradingSession.mockResolvedValue(true);
    mocks.getDepositWalletStatus.mockResolvedValue({ depositWallet: "0xdead", initialized: false });
    mocks.getPolymarketExchangeConfig.mockReturnValue({
      exchange: "0xexchange",
      conditionalTokens: "0xconditional",
      collateral: "0xcollateral",
    });
    const assetTypes: string[] = [];
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
          assetTypes.push(String(body.assetType));
          expect(body.signatureType).toBe(2);
          return new Response(JSON.stringify({ ok: true, data: {} }), { status: 200 });
        }
        if (url.includes("/api/polymarket/auth/status") || url.includes("/api/polymarket/auth/init")) {
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
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

    expect(result.signatureType).toBe(2);
    expect(result.walletMode).toBe("legacy-proxy");
    expect(assetTypes).toEqual(expect.arrayContaining(["COLLATERAL", "CONDITIONAL"]));
    expect(mocks.ensureApprovals).toHaveBeenCalled();
    expect(mocks.ensureOperatorApproval).toHaveBeenCalled();
    expect(mocks.ensureDepositWalletDeployed).not.toHaveBeenCalled();
  });

  it("does not require account success before the trade setup completes", async () => {
    stubConfig();
    stubRelayClient({ expectedSafe: "0xsafe", proxyDeployed: false, depositWalletAddress: "0xdead", depositWalletDeployed: true });
    mocks.ensureTradingSession.mockResolvedValue(true);
    mocks.getDepositWalletStatus.mockResolvedValue({ depositWallet: "0xdead", initialized: true });
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
          return new Response(JSON.stringify({ ok: false, code: "AUTH_INVALID_SESSION", error: "Unauthorized/Invalid api key" }), { status: 401 });
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

    expect(accountCalls).toBe(0);
    expect(mocks.ensureTradingSession).toHaveBeenCalled();
    expect(result.depositWalletAddress).toBe("0xdead");
  });
});
