import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { marketStore } from "@/app/store/marketStore";
import { hasUsefulFavoredPrice, MarketsExplorer } from "@/components/MarketsExplorer";
import { getFavoredOutcome } from "@/components/MarketBubbleMap";
import { rankHighValueMarkets } from "@/lib/polymarket/marketDisplay";
import type { MarketPage, SportsMarketDiscovery } from "@/lib/polymarket/markets";
import type { TerminalMarket } from "@/lib/polymarket/types";

const market: TerminalMarket = {
  id: "market-1",
  conditionId: "condition-1",
  slug: "nba-market-1",
  title: "NBA market 1",
  sport: "Basketball",
  league: "NBA",
  status: "live",
  startTime: "2026-06-01T00:00:00Z",
  endTime: "2026-06-01T03:00:00Z",
  yesPrice: 0.52,
  noPrice: 0.48,
  volume24h: 1000,
  volume: 5000,
  liquidity: 3000,
  priceMove24h: 0.02,
  volume1wk: 7000,
  volumeAcceleration: 1,
  spread: 0.02,
  recentTradesCount: 12,
  opportunityScore: 58,
  outcomes: { yes: "YES", no: "NO" },
  tokenIds: { yes: "111", no: "222" },
  source: "polymarket",
};

const counts: SportsMarketDiscovery["counts"] = {
  eventPagesFetched: 1,
  eventsFetched: 1,
  rawMarkets: 1,
  sportsMarkets: 1,
  openSportsMarkets: 1,
  tradableMarkets: 1,
  tradableSportsMarkets: 1,
  liveSportsMarkets: 1,
  upcomingSportsMarkets: 0,
  staleOrUnknownSportsMarkets: 0,
  displayedMarkets: 1,
  totalEligibleSportsMarkets: 1,
  marketsWithMinVolume: 1,
  liveWithMinVolume: 1,
  upcomingWithMinVolume: 0,
  staleExcluded: 0,
  minVolume: 2000,
  excludedClosed: 0,
  excludedInactive: 0,
  excludedMissingClobTokenIds: 0,
  excludedNoOrderbook: 0,
  excludedInvalidPrices: 0,
};

const initialPage: MarketPage = {
  markets: [market],
  limit: 100,
  offset: 0,
  total: 1,
  returned: 1,
  hasMore: false,
};

describe("MarketsExplorer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    marketStore.reset();
  });

  it("calls the markets API with filter params", async () => {
    const requestedUrls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.includes("/counts")) {
        return new Response(JSON.stringify({ loading: false, counts, source: "polymarket" }), { status: 200 });
      }
      if (url.includes("/prewarm")) {
        return new Response(JSON.stringify({ started: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ ...initialPage, counts, countsLoading: false, source: "polymarket" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<MarketsExplorer initialPage={initialPage} source="polymarket" />);

    fireEvent.click(screen.getByRole("button", { name: "NBA" }));
    fireEvent.change(screen.getByLabelText("Market range"), { target: { value: "200" } });
    fireEvent.change(screen.getByPlaceholderText("Search markets..."), { target: { value: "knicks" } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(
      () => {
        const lastCall = [...requestedUrls].reverse().find((url) => url.includes("/api/polymarket/markets?"));
        expect(lastCall).toBeDefined();
        const params = new URL(lastCall as string, "http://localhost").searchParams;
        expect(params.get("limit")).toBe("250");
        expect(params.get("offset")).toBe("0");
        expect(params.get("minVolume")).toBe("2000");
        expect(params.get("sport")).toBe("NBA");
        expect(params.get("status")).toBe("all");
        expect(params.get("sort")).toBe("liquidity");
        expect(params.has("search")).toBe(false);
      },
      { timeout: 1000 },
    );
    expect(screen.queryByRole("button", { name: /view nba markets/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Explore NBA" })).toBeInTheDocument();
  });

  it("filters out extreme favored prices before range display", () => {
    expect(hasUsefulFavoredPrice({ ...market, yesPrice: 0.99, noPrice: 0.01 })).toBe(false);
    expect(hasUsefulFavoredPrice({ ...market, yesPrice: 0.95, noPrice: 0.05 })).toBe(false);
    expect(hasUsefulFavoredPrice({ ...market, yesPrice: 0.1, noPrice: 0.09 })).toBe(false);
    expect(hasUsefulFavoredPrice({ ...market, yesPrice: 0.05, noPrice: 0.04 })).toBe(false);
    expect(hasUsefulFavoredPrice({ ...market, yesPrice: 0.5, noPrice: 0.5 })).toBe(true);
    expect(hasUsefulFavoredPrice({ ...market, yesPrice: 0.7, noPrice: 0.3 })).toBe(true);
    expect(hasUsefulFavoredPrice({ ...market, yesPrice: 0.94, noPrice: 0.06 })).toBe(true);
  });

  it("renders only useful-price markets from the fetched ranked page", async () => {
    const page: MarketPage = {
      ...initialPage,
      markets: [
        { ...market, id: "too-high", yesPrice: 0.99, noPrice: 0.01 },
        { ...market, id: "too-low", yesPrice: 0.05, noPrice: 0.04 },
        { ...market, id: "fair-50", yesPrice: 0.5, noPrice: 0.5 },
        { ...market, id: "fair-70", yesPrice: 0.7, noPrice: 0.3 },
      ],
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ...page, counts, countsLoading: false, source: "polymarket" }), { status: 200 })));

    render(<MarketsExplorer initialPage={page} source="polymarket" />);

    expect(screen.getByRole("application", { name: /2 sports market bubble map/i })).toBeInTheDocument();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
  });

  it("treats ranges as categorical ranked slices", async () => {
    const markets = Array.from({ length: 60 }, (_, index) => ({
      ...market,
      id: `market-${index}`,
      conditionId: `condition-${index}`,
      title: `NBA market ${index}`,
      volume: 100_000 - index,
    }));
    const page: MarketPage = {
      ...initialPage,
      markets,
      total: markets.length,
      returned: markets.length,
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ...page, counts, countsLoading: false, source: "polymarket" }), { status: 200 })));

    render(<MarketsExplorer initialPage={page} source="polymarket" />);

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.getByRole("application", { name: /50 sports market bubble map/i })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Market range"), { target: { value: "50" } });

    expect(screen.getByRole("application", { name: /10 sports market bubble map/i })).toBeInTheDocument();
  });

  it("keeps existing bubbles visible while refreshing", async () => {
    let resolveFetch: (value?: void | PromiseLike<void>) => void = () => undefined;
    const pending = new Promise<void>((resolve) => {
      resolveFetch = resolve;
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/counts")) {
        return new Response(JSON.stringify({ loading: false, counts, source: "polymarket" }), { status: 200 });
      }
      if (url.includes("/prewarm")) {
        return new Response(JSON.stringify({ started: true }), { status: 200 });
      }
      return pending.then(() => new Response(JSON.stringify({ ...initialPage, counts, countsLoading: false, source: "polymarket" }), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<MarketsExplorer initialPage={initialPage} source="polymarket" />);

    expect(screen.getByRole("application", { name: /1 sports market bubble map/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "UFC" }));

    await waitFor(() => expect(screen.getAllByText("Refreshing markets").length).toBeGreaterThan(0));
    expect(screen.getByRole("application", { name: /1 sports market bubble map/i })).toBeInTheDocument();
    expect(screen.queryByText("Loading sports bubbles...")).not.toBeInTheDocument();

    resolveFetch();
    await pending;
  });

  it("keeps the ranked fetch size fixed when selecting a range slice", async () => {
    const requestedUrls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.includes("/counts")) {
        return new Response(JSON.stringify({ loading: false, counts, source: "polymarket" }), { status: 200 });
      }
      if (url.includes("/prewarm")) {
        return new Response(JSON.stringify({ started: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ ...initialPage, hasMore: true, counts, countsLoading: false, source: "polymarket" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<MarketsExplorer initialPage={{ ...initialPage, hasMore: true }} source="polymarket" />);

    fireEvent.change(screen.getByLabelText("Market range"), { target: { value: "200" } });

    await waitFor(() => {
      const lastCall = [...requestedUrls].reverse().find((url) => url.includes("/api/polymarket/markets?"));
      expect(lastCall).toBeDefined();
      const params = new URL(lastCall as string, "http://localhost").searchParams;
      expect(params.get("minVolume")).toBe("2000");
      expect(params.get("limit")).toBe("250");
      expect(params.get("offset")).toBe("0");
    });
  });

  it("manual refresh reloads markets and recalculates favored outcome", async () => {
    const refreshed = { ...market, yesPrice: 0.48, noPrice: 0.52 };
    let requestCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        requestCount += 1;
        const markets = requestCount >= 2 ? [refreshed] : [market];
        return new Response(JSON.stringify({ ...initialPage, markets, counts, countsLoading: false, source: "polymarket" }), { status: 200 });
      }),
    );

    render(<MarketsExplorer initialPage={{ ...initialPage, markets: [market] }} source="polymarket" />);

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Refresh markets" }));

    await waitFor(() => expect(marketStore.getState().marketsById["market-1"].noPrice).toBe(0.52));
    expect(getFavoredOutcome(marketStore.getState().marketsById["market-1"]).price).toBe(0.52);
  });

  it("live updates do not remove or replace visible bubbles that cross 95 cents", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ...initialPage, counts, countsLoading: false, source: "polymarket" }), { status: 200 })));
    render(<MarketsExplorer initialPage={initialPage} source="polymarket" />);

    expect(screen.getByRole("application", { name: /1 sports market bubble map/i })).toBeInTheDocument();
    marketStore.applyMarketSnapshots([{ ...market, yesPrice: 0.99, noPrice: 0.01 }]);

    expect(screen.getByRole("application", { name: /1 sports market bubble map/i })).toBeInTheDocument();
  });

  it("manual refresh removes markets that are now outside active odds range", async () => {
    let requestCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        requestCount += 1;
        const markets = requestCount >= 2 ? [{ ...market, yesPrice: 0.99, noPrice: 0.01 }] : [market];
        return new Response(JSON.stringify({ ...initialPage, markets, counts, countsLoading: false, source: "polymarket" }), { status: 200 });
      }),
    );

    render(<MarketsExplorer initialPage={{ ...initialPage, markets: [market] }} source="polymarket" />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.getByRole("application", { name: /1 sports market bubble map/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Refresh markets" }));

    await waitFor(() => expect(screen.getByRole("application", { name: /0 sports market bubble map/i })).toBeInTheDocument());
  });

  it("sorts high-value discovery markets by liquidity, volume, then useful odds", () => {
    const lowLiquidity = { ...market, id: "low-liq", liquidity: 1_000, volume: 1_000_000, yesPrice: 0.52, noPrice: 0.48 };
    const highLiquidityLowVolume = { ...market, id: "high-liq-low-vol", liquidity: 9_000, volume: 10_000, yesPrice: 0.9, noPrice: 0.1 };
    const highLiquidityHighVolume = { ...market, id: "high-liq-high-vol", liquidity: 9_000, volume: 20_000, yesPrice: 0.8, noPrice: 0.2 };
    const sameQualityBetterOdds = { ...market, id: "same-quality-better-odds", liquidity: 9_000, volume: 20_000, yesPrice: 0.62, noPrice: 0.38 };

    expect(rankHighValueMarkets([lowLiquidity, highLiquidityLowVolume, highLiquidityHighVolume, sameQualityBetterOdds]).map((item) => item.id)).toEqual([
      "same-quality-better-odds",
      "high-liq-high-vol",
      "high-liq-low-vol",
      "low-liq",
    ]);
  });

  it("searches the stable snapshot and opens a frozen trade panel result", async () => {
    const page: MarketPage = {
      ...initialPage,
      markets: [
        market,
        { ...market, id: "market-2", conditionId: "condition-2", title: "Arsenal vs Chelsea", sport: "Soccer", league: "EPL", liquidity: 10_000, volume: 20_000 },
      ],
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ...page, counts, countsLoading: false, source: "polymarket" }), { status: 200 })));

    render(<MarketsExplorer initialPage={page} source="polymarket" />);

    fireEvent.change(screen.getByPlaceholderText("Search markets..."), { target: { value: "arsenal" } });
    expect(screen.getByText("Snapshot results")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /arsenal vs chelsea/i }));

    expect(screen.getByRole("heading", { name: "Arsenal vs. Chelsea" })).toBeInTheDocument();
  });
});
