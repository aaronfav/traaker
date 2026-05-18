import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetMarketSnapshotCache, seedMarketSnapshotCache, type SportsMarketDiscovery } from "@/lib/polymarket/markets";
import type { TerminalMarket } from "@/lib/polymarket/types";

function market(index: number, overrides: Partial<TerminalMarket> = {}): TerminalMarket {
  return {
    id: `market-${index}`,
    conditionId: `condition-${index}`,
    slug: `nba-market-${index}`,
    title: `NBA market ${index}`,
    sport: "Basketball",
    league: "NBA",
    status: index % 2 === 0 ? "live" : "upcoming",
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
    liveSportsMarkets: 1,
    upcomingSportsMarkets: 2,
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

function makeGammaEventPage(page: number, eventCount = 1) {
  if (page > 0) return [];
  return Array.from({ length: eventCount }, (_, index) => ({
    id: `event-${index + 1}`,
    slug: `nba-event-${index + 1}`,
    title: `NBA event ${index + 1}`,
    category: "Sports",
    closed: false,
    startDate: "2026-06-01T00:00:00Z",
    endDate: "2026-06-01T03:00:00Z",
    markets: [
      {
        id: `market-${index + 1}`,
        conditionId: `condition-${index + 1}`,
        question: `NBA market ${index + 1}`,
        slug: `nba-market-${index + 1}`,
        active: true,
        acceptingOrders: true,
        enableOrderBook: true,
        clobTokenIds: [`yes-${index + 1}`, `no-${index + 1}`],
        outcomes: ["YES", "NO"],
        outcomePrices: [0.55, 0.45],
        bestAsk: 0.55,
        volume24h: 100,
        liquidity: 200,
        tags: [{ label: "NBA" }],
        category: "Sports",
      },
    ],
  }));
}

async function callMarketsApi(query = "") {
  const { GET } = await import("@/app/api/polymarket/markets/route");
  const response = await GET(new Request(`http://localhost/api/polymarket/markets${query}`));
  return response.json();
}

async function callCountsApi() {
  const { GET } = await import("@/app/api/polymarket/markets/counts/route");
  const response = await GET();
  return response.json();
}

async function callPrewarmApi() {
  const { GET } = await import("@/app/api/polymarket/markets/prewarm/route");
  const response = await GET();
  return response.json();
}

describe("/api/polymarket/markets", () => {
  beforeEach(() => {
    resetMarketSnapshotCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetMarketSnapshotCache();
  });

  it("respects limit and offset from cached snapshot", async () => {
    seedMarketSnapshotCache(discovery);

    const payload = await callMarketsApi("?limit=1&offset=1");

    expect(payload.limit).toBe(1);
    expect(payload.offset).toBe(1);
    expect(payload.returned).toBe(1);
    expect(payload.total).toBe(3);
    expect(payload.markets[0].id).toBe("market-2");
  });

  it("returns a cold first page without waiting for full snapshot warmup", async () => {
    const secondPage = { resolve: undefined as undefined | ((value: Response) => void) };
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("offset=0")) {
        return Promise.resolve(new Response(JSON.stringify(makeGammaEventPage(0, 200)), { status: 200 }));
      }
      if (url.includes("offset=200")) {
        return new Promise<Response>((resolve) => {
          secondPage.resolve = resolve;
        });
      }
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const startedAt = Date.now();
    const payload = await callMarketsApi("?limit=1");
    const durationMs = Date.now() - startedAt;

    expect(durationMs).toBeLessThan(500);
    expect(payload.countsLoading).toBe(true);
    expect(payload.returned).toBe(1);
    expect(fetchMock).toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("offset=200"))).toBe(true);

    if (secondPage.resolve) {
      secondPage.resolve(new Response(JSON.stringify([]), { status: 200 }));
    }
  });

  it("returns loading counts when the snapshot is not ready", async () => {
    const fetchMock = vi.fn(async () => new Promise<Response>(() => undefined));
    vi.stubGlobal("fetch", fetchMock);

    const payload = await callCountsApi();

    expect(payload.loading).toBe(true);
    expect(fetchMock).toHaveBeenCalled();
  });

  it("prewarm starts the snapshot build", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("offset=0")) {
        return new Response(JSON.stringify(makeGammaEventPage(0, 200)), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const payload = await callPrewarmApi();

    expect(payload.started).toBe(true);
    expect(fetchMock).toHaveBeenCalled();
  });

  it("uses the snapshot cache after warmup", async () => {
    seedMarketSnapshotCache(discovery);

    const fetchMock = vi.fn(async () => new Response(JSON.stringify([]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const payload = await callMarketsApi("?limit=1&offset=1");

    expect(payload.limit).toBe(1);
    expect(payload.offset).toBe(1);
    expect(payload.returned).toBe(1);
    expect(payload.total).toBe(3);
    expect(payload.markets[0].id).toBe("market-2");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not refetch Gamma for filter changes when the snapshot exists", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/events?") && url.includes("offset=0")) {
        return new Response(JSON.stringify(makeGammaEventPage(0)), { status: 200 });
      }
      return new Response(JSON.stringify(makeGammaEventPage(1)), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await callMarketsApi("?limit=1");
    const fetchesAfterFirst = fetchMock.mock.calls.length;

    await callMarketsApi("?limit=1&sport=NBA&status=live&sort=volume");
    expect(fetchMock.mock.calls.length).toBe(fetchesAfterFirst);
  });
});
