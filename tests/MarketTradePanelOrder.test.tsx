import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarketTradePanel } from "@/components/MarketTradePanel";
import type { MarketBubbleNode } from "@/components/MarketBubbleMap";

const mocks = vi.hoisted(() => ({
  placeMarketOrder: vi.fn(),
  createSignerClient: vi.fn(),
  ensureTradingReady: vi.fn(),
  resolveTradingWalletContext: vi.fn(),
  publicClient: {},
  account: { chainId: 137, isConnected: true },
  walletClient: { account: { address: "0x123" } },
  walletContext: {
    depositWalletAddress: "0xdeadbeef",
    depositWalletInitialized: true,
    proxyWalletAddress: "0xsafe",
    proxyDeployed: true,
    tradingWalletAddress: "0xdeadbeef",
    signatureType: 3,
    walletMode: "deposit-wallet",
  },
  tradingSetup: {
    depositWalletAddress: "0xdeadbeef",
    depositWalletInitialized: true,
    proxyWalletAddress: "0xsafe",
    tradingWalletAddress: "0xdeadbeef",
    signatureType: 3,
    walletMode: "deposit-wallet",
    balance: {
      usdc: {
        balance: 100,
        rawBalance: "100000000",
        allowances: { exchange: "1", conditional: "1" },
        exchangeAllowance: "1",
        ctfAllowance: "1",
        hasExchangeAllowance: true,
        hasCtfAllowance: true,
      },
      pUsd: null,
      conditional: null,
      source: "polymarket",
    },
    accountResponse: {},
  },
}));

vi.mock("wagmi", () => ({
  useAccount: () => mocks.account,
  useWalletClient: () => ({ data: mocks.walletClient }),
  usePublicClient: () => mocks.publicClient,
}));

vi.mock("@/lib/polymarket/tradeSetup", () => ({
  ensureTradingReady: mocks.ensureTradingReady,
  resolveTradingWalletContext: mocks.resolveTradingWalletContext,
}));

vi.mock("@/lib/polymarket/client", () => ({
  createSignerClient: mocks.createSignerClient,
  SignatureTypeV2: { POLY_1271: 3 },
}));

vi.mock("@/lib/polymarket/orders", async () => {
  const actual = await vi.importActual<typeof import("@/lib/polymarket/orders")>("@/lib/polymarket/orders");
  return {
    ...actual,
    placeMarketOrder: mocks.placeMarketOrder,
  };
});

const market: MarketBubbleNode = {
  id: "uefa-champions-league-winner",
  conditionId: "psg-condition",
  title: "UEFA Champions League Winner",
  sport: "UCL",
  volume: 100000,
  liquidity: 75000,
  priceChange: 0,
  polymarketUrl: "https://polymarket.com/event/uefa-champions-league-winner",
  primaryColor: "#0ea5e9",
  secondaryColor: "#67e8f9",
  glowColor: "rgba(14,165,233,0.5)",
  favoredOutcome: "PSG",
  favoredPrice: 0.59,
  priceCents: 59,
  outcomes: [
    { name: "PSG", price: 0.59, priceCents: 59, tokenId: "111111", marketId: "psg-market", conditionId: "psg-condition" },
    { name: "Arsenal", price: 0.43, priceCents: 43, tokenId: "222221", marketId: "arsenal-market", conditionId: "arsenal-condition" },
  ],
  trendScore: 10,
  isTrending: true,
  driftPhase: 0,
  val: 90,
  targetX: 0,
  targetY: 0,
  x: 0,
  y: 0,
};

describe("MarketTradePanel orders", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("submits the selected outcome's real CLOB tokenID", async () => {
    mocks.resolveTradingWalletContext.mockResolvedValue(mocks.walletContext);
    mocks.ensureTradingReady.mockResolvedValue(mocks.tradingSetup);
    mocks.createSignerClient.mockResolvedValue({ client: "signed" });
    mocks.placeMarketOrder.mockResolvedValue({ orderID: "order-1" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/polymarket/config"))
          return new Response(JSON.stringify({ ok: true, realTradingEnabled: true, builderReady: true, gaslessReady: true, clobReady: true, missingSetupReason: null }), { status: 200 });
        if (url.includes("/api/polymarket/account"))
          return new Response(JSON.stringify({ ok: true, balance: { balance: "100000000", allowances: { exchange: "1", conditional: "1" } } }), { status: 200 });
        return new Response(JSON.stringify({}), { status: 200 });
      }),
    );

    render(<MarketTradePanel market={market} onClose={vi.fn()} />);

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/polymarket/config", { cache: "no-store" }));
    fireEvent.click(screen.getByRole("button", { name: /arsenal\s+43/i }));
    fireEvent.click(screen.getByRole("button", { name: /buy arsenal\s+43/i }));

    await waitFor(() => expect(mocks.createSignerClient).toHaveBeenCalled());
    expect(mocks.createSignerClient).toHaveBeenCalledWith(
      expect.objectContaining({
        signer: mocks.walletClient,
        signatureType: 3,
        funderAddress: "0xdeadbeef",
      }),
    );
    expect(mocks.ensureTradingReady).toHaveBeenCalledWith(
      expect.objectContaining({
        side: "Buy",
        tokenId: "222221",
        amount: 4.3,
        price: 0.43,
      }),
    );
    await waitFor(() => expect(mocks.placeMarketOrder).toHaveBeenCalled());
    expect(mocks.placeMarketOrder).toHaveBeenCalledWith(
      { client: "signed" },
      expect.objectContaining({
        tokenID: "222221",
        amount: 4.3,
        currentPrice: 0.43,
        maxSlippageBps: 1300,
      }),
    );
  });

  it("runs the trading setup flow when the deposit wallet is missing", async () => {
    mocks.resolveTradingWalletContext.mockResolvedValue({
      ...mocks.walletContext,
      depositWalletInitialized: false,
      walletMode: "deposit-wallet",
    });
    mocks.ensureTradingReady.mockResolvedValue(mocks.tradingSetup);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/polymarket/config"))
          return new Response(JSON.stringify({ ok: true, realTradingEnabled: true, builderReady: true, gaslessReady: true, clobReady: true, missingSetupReason: null }), { status: 200 });
        if (url.includes("/api/polymarket/account")) return new Response(JSON.stringify({ ok: true }), { status: 200 });
        return new Response(JSON.stringify({}), { status: 200 });
      }),
    );

    render(<MarketTradePanel market={market} onClose={vi.fn()} />);

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/polymarket/config", { cache: "no-store" }));
    const buyButton = screen.getByRole("button", { name: /buy psg\s+59/i });
    const sellButton = screen.getByRole("button", { name: /sell psg\s+59/i });
    expect(buyButton).toBeEnabled();
    expect(sellButton).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: /arsenal\s+43/i }));
    fireEvent.click(buyButton);

    await waitFor(() => expect(mocks.ensureTradingReady).toHaveBeenCalled());
    await waitFor(() => expect(mocks.placeMarketOrder).toHaveBeenCalled());
  });

  it("auto-refreshes a stale quote before buying and submits with the refreshed price", async () => {
    mocks.resolveTradingWalletContext.mockResolvedValue(mocks.walletContext);
    mocks.ensureTradingReady.mockResolvedValue(mocks.tradingSetup);
    mocks.createSignerClient.mockResolvedValue({ client: "signed" });
    mocks.placeMarketOrder.mockResolvedValue({ orderID: "order-2" });
    const refreshedMarket = {
      ...market,
      favoredPrice: 0.71,
      priceCents: 71,
      outcomes: [
        { name: "PSG", price: 0.71, priceCents: 71, tokenId: "111111", marketId: "psg-market", conditionId: "psg-condition" },
        { name: "Arsenal", price: 0.29, priceCents: 29, tokenId: "222221", marketId: "arsenal-market", conditionId: "arsenal-condition" },
      ],
    };
    const onUpdatePrices = vi.fn().mockRejectedValueOnce(new Error("network down")).mockResolvedValueOnce(refreshedMarket);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/polymarket/config"))
          return new Response(JSON.stringify({ ok: true, realTradingEnabled: true, builderReady: true, gaslessReady: true, clobReady: true, missingSetupReason: null }), { status: 200 });
        if (url.includes("/api/polymarket/account"))
          return new Response(JSON.stringify({ ok: true, balance: { balance: "100000000", allowances: { exchange: "1", conditional: "1" } } }), { status: 200 });
        return new Response(JSON.stringify({}), { status: 200 });
      }),
    );

    render(<MarketTradePanel market={market} onClose={vi.fn()} onUpdatePrices={onUpdatePrices} />);

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/polymarket/config", { cache: "no-store" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /refresh quote now/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /buy psg\s+59/i }));
    });

    expect(onUpdatePrices).toHaveBeenCalledTimes(2);
    expect(mocks.placeMarketOrder).toHaveBeenCalledWith(
      { client: "signed" },
      expect.objectContaining({
        tokenID: "111111",
        amount: 7.1,
        currentPrice: 0.71,
        maxSlippageBps: 1300,
      }),
    );
  });

  it("retries quote refresh once before buying and still submits if the retry succeeds", async () => {
    mocks.resolveTradingWalletContext.mockResolvedValue(mocks.walletContext);
    mocks.ensureTradingReady.mockResolvedValue(mocks.tradingSetup);
    mocks.createSignerClient.mockResolvedValue({ client: "signed" });
    mocks.placeMarketOrder.mockResolvedValue({ orderID: "order-3" });
    const refreshedMarket = {
      ...market,
      favoredPrice: 0.68,
      priceCents: 68,
      outcomes: [
        { name: "PSG", price: 0.68, priceCents: 68, tokenId: "111111", marketId: "psg-market", conditionId: "psg-condition" },
        { name: "Arsenal", price: 0.32, priceCents: 32, tokenId: "222221", marketId: "arsenal-market", conditionId: "arsenal-condition" },
      ],
    };
    const onUpdatePrices = vi.fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockRejectedValueOnce(new Error("still down"))
      .mockResolvedValueOnce(refreshedMarket);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/polymarket/config"))
          return new Response(JSON.stringify({ ok: true, realTradingEnabled: true, builderReady: true, gaslessReady: true, clobReady: true, missingSetupReason: null }), { status: 200 });
        if (url.includes("/api/polymarket/account"))
          return new Response(JSON.stringify({ ok: true, balance: { balance: "100000000", allowances: { exchange: "1", conditional: "1" } } }), { status: 200 });
        return new Response(JSON.stringify({}), { status: 200 });
      }),
    );

    render(<MarketTradePanel market={market} onClose={vi.fn()} onUpdatePrices={onUpdatePrices} />);

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/polymarket/config", { cache: "no-store" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /refresh quote now/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /buy psg\s+59/i }));
    });

    expect(onUpdatePrices).toHaveBeenCalledTimes(3);
    expect(mocks.placeMarketOrder).toHaveBeenCalledWith(
      { client: "signed" },
      expect.objectContaining({
        tokenID: "111111",
        currentPrice: 0.68,
        maxSlippageBps: 1300,
        side: "BUY",
        userUSDCBalance: Number.MAX_SAFE_INTEGER,
      }),
    );
    expect(mocks.placeMarketOrder.mock.calls[0]?.[1].amount).toBeCloseTo(6.8, 5);
  });
});
