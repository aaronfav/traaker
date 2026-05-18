import { afterEach, describe, expect, it, vi } from "vitest";
import type { SportsMarketDiscovery } from "@/lib/polymarket/markets";
import type { TerminalMarket } from "@/lib/polymarket/types";

function market(index: number, overrides: Partial<TerminalMarket> = {}): TerminalMarket {
  return {
    id: `market-${index}`,
    conditionId: `condition-${index}`,
    slug: `nba-market-${index}`,
    title: `NBA market ${index}`,
    sport: "Basketball",
    league: "NBA",
    status: "upcoming",
    startTime: "2026-06-01T00:00:00Z",
    endTime: "2026-06-01T03:00:00Z",
    yesPrice: 0.52,
    noPrice: 0.48,
    volume24h: index * 100,
    volume: index * 1000,
    liquidity: index * 50,
    priceMove24h: index / 100,
    volume1wk: index * 1000,
    volumeAcceleration: 1,
    spread: 0.02,
    recentTradesCount: 10,
    opportunityScore: index,
    outcomes: { yes: "YES", no: "NO" },
    tokenIds: { yes: `yes-${index}`, no: `no-${index}` },
    source: "polymarket",
    ...overrides,
  };
}

const markets = Array.from({ length: 3 }, (_, index) => market(index + 1));
const discovery: SportsMarketDiscovery = {
  markets,
  debugMarkets: markets,
  counts: {
    eventPagesFetched: 1,
    eventsFetched: 1,
    rawMarkets: 3,
    sportsMarkets: 3,
    openSportsMarkets: 3,
    tradableMarkets: 3,
    tradableSportsMarkets: 3,
    liveSportsMarkets: 0,
    upcomingSportsMarkets: 3,
    staleOrUnknownSportsMarkets: 0,
    displayedMarkets: 3,
    excludedClosed: 0,
    excludedInactive: 0,
    excludedMissingClobTokenIds: 0,
    excludedNoOrderbook: 0,
    excludedInvalidPrices: 0,
  },
  source: "polymarket",
};

describe("/api/polymarket/markets", () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("respects limit and offset", async () => {
    const marketModule = await import("@/lib/polymarket/markets");
    vi.spyOn(marketModule, "getCachedMarketsApiPayload").mockImplementation(async (params) => ({
      counts: discovery.counts,
      source: discovery.source,
      ...marketModule.getMarketPage(discovery, params),
    }));
    const { GET } = await import("@/app/api/polymarket/markets/route");

    const response = await GET(new Request("http://localhost/api/polymarket/markets?limit=1&offset=1"));
    const payload = await response.json();

    expect(payload.limit).toBe(1);
    expect(payload.offset).toBe(1);
    expect(payload.returned).toBe(1);
    expect(payload.total).toBe(3);
    expect(payload.markets[0].id).toBe("market-2");
  });

  it("caps limit at 500", async () => {
    const marketModule = await import("@/lib/polymarket/markets");
    vi.spyOn(marketModule, "getCachedMarketsApiPayload").mockImplementation(async (params) => ({
      counts: discovery.counts,
      source: discovery.source,
      ...marketModule.getMarketPage(discovery, params),
    }));
    const { GET } = await import("@/app/api/polymarket/markets/route");

    const response = await GET(new Request("http://localhost/api/polymarket/markets?limit=9999"));
    const payload = await response.json();

    expect(payload.limit).toBe(500);
    expect(payload.returned).toBe(3);
  });
});
