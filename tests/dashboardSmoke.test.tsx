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
  excludedClosed: 0,
  excludedInactive: 0,
  excludedMissingClobTokenIds: 0,
  excludedNoOrderbook: 0,
  excludedInvalidPrices: 0,
};

vi.mock("@/lib/polymarket/markets", async () => ({
  ...(await vi.importActual<typeof import("@/lib/polymarket/markets")>("@/lib/polymarket/markets")),
  getCachedMarketCountsSnapshot: vi.fn(() => counts),
}));

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({
        counts,
        source: "polymarket",
        markets: markets.slice(0, 100),
        limit: 100,
        offset: 0,
        total: 150,
        returned: 100,
        hasMore: true,
      }), { status: 200 })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders market rows", async () => {
    render(await DashboardPage());
    expect(screen.getByRole("heading", { name: /trading terminal/i })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText("NBA test market 0").length).toBeGreaterThan(0));
  });

  it("does not render every discovered market on first paint", async () => {
    render(await DashboardPage());
    await waitFor(() => expect(screen.getByText(/Showing 100 of 150 matching markets/i)).toBeInTheDocument());
    expect(screen.queryByText("NBA test market 149")).not.toBeInTheDocument();
  });
});
