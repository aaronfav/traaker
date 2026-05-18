import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarketsExplorer } from "@/components/MarketsExplorer";
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
  });

  it("calls the markets API with filter params", async () => {
    const requestedUrls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      requestedUrls.push(String(input));
      return new Response(JSON.stringify({ ...initialPage, counts, source: "polymarket" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<MarketsExplorer counts={counts} initialPage={initialPage} source="polymarket" />);

    fireEvent.click(screen.getByRole("button", { name: "NBA" }));
    fireEvent.click(screen.getByRole("button", { name: "live" }));
    fireEvent.click(screen.getByRole("button", { name: "Volume" }));
    fireEvent.change(screen.getByPlaceholderText("Search teams, leagues, outcomes"), { target: { value: "knicks" } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(
      () => {
        const lastCall = requestedUrls[requestedUrls.length - 1];
        expect(lastCall).toContain("/api/polymarket/markets?");
        const params = new URL(lastCall, "http://localhost").searchParams;
        expect(params.get("limit")).toBe("100");
        expect(params.get("offset")).toBe("0");
        expect(params.get("sport")).toBe("NBA");
        expect(params.get("status")).toBe("live");
        expect(params.get("sort")).toBe("volume");
        expect(params.get("search")).toBe("knicks");
      },
      { timeout: 1000 },
    );
  });
});
