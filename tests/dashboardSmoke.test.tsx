import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DashboardPage from "@/app/page";
import type { TerminalMarket } from "@/lib/polymarket/types";

function makeMarket(index: number): TerminalMarket {
  return {
  id: `0xabc-${index}`,
  conditionId: `0xabc-${index}`,
  slug: `nba-test-${index}`,
  title: `NBA test market ${index}`,
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
}

const markets = Array.from({ length: 150 }, (_, index) => makeMarket(index));
const counts = {
  eventPagesFetched: 1,
  eventsFetched: 1,
  rawMarkets: 150,
  sportsMarkets: 150,
  openSportsMarkets: 150,
  tradableMarkets: 150,
  tradableSportsMarkets: 150,
  liveSportsMarkets: 150,
  upcomingSportsMarkets: 0,
  staleOrUnknownSportsMarkets: 0,
  displayedMarkets: 150,
  totalEligibleSportsMarkets: 150,
  marketsWithMinVolume: 150,
  liveWithMinVolume: 150,
  upcomingWithMinVolume: 0,
  staleExcluded: 0,
  minVolume: 2000,
  excludedClosed: 0,
  excludedInactive: 0,
  excludedMissingClobTokenIds: 0,
  excludedNoOrderbook: 0,
  excludedInvalidPrices: 0,
};

vi.mock("@/lib/polymarket/markets", async () => ({
  ...(await vi.importActual<typeof import("@/lib/polymarket/markets")>("@/lib/polymarket/markets")),
  getCachedMarketCountsState: vi.fn(() => ({ loading: false, counts, source: "polymarket" })),
}));

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/counts")) {
          return new Response(JSON.stringify({ loading: false, counts, source: "polymarket" }), { status: 200 });
        }
        if (url.includes("/prewarm")) {
          return new Response(JSON.stringify({ started: true }), { status: 200 });
        }
        const limit = Number(new URL(url, "http://localhost").searchParams.get("limit") ?? 50);
        return new Response(JSON.stringify({
          counts,
          countsLoading: false,
          source: "polymarket",
          markets: markets.slice(0, limit),
          limit,
          offset: 0,
          total: 150,
          returned: limit,
          hasMore: true,
        }), { status: 200 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the bubble map", async () => {
    render(await DashboardPage());
    expect(screen.getByPlaceholderText("Search markets...")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /trading terminal/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/polymarket sports/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/minimum volume/i, { selector: "p" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("application", { name: /50 sports market bubble map/i })).toBeInTheDocument());
    expect(screen.getByLabelText("Market range")).toHaveValue("50");
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(expect.stringContaining("limit=50"), expect.any(Object));
  });

  it("does not render every discovered market on first paint", async () => {
    render(await DashboardPage());
    await waitFor(() => expect(screen.getByRole("application", { name: /50 sports market bubble map/i })).toBeInTheDocument());
    expect(screen.queryByText("NBA test market 149")).not.toBeInTheDocument();
  });
});
