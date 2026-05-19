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
    totalEligibleSportsMarkets: 3,
    marketsWithMinVolume: 3,
    liveWithMinVolume: 1,
    upcomingWithMinVolume: 2,
    staleExcluded: 0,
    minVolume: 2000,
    excludedClosed: 0,
    excludedInactive: 0,
    excludedMissingClobTokenIds: 0,
    excludedNoOrderbook: 0,
    excludedInvalidPrices: 0,
  },
  source: "polymarket",
};

function makeGammaEventPage(page: number, eventCount = 1, volumeForIndex: (index: number) => number = () => 5000, sportForIndex: (index: number) => boolean = () => true) {
  if (page > 0) return [];
  return Array.from({ length: eventCount }, (_, index) => ({
    id: `event-${index + 1}`,
    slug: sportForIndex(index) ? `nba-event-${index + 1}` : `politics-event-${index + 1}`,
    title: sportForIndex(index) ? `NBA event ${index + 1}` : `Election event ${index + 1}`,
    category: sportForIndex(index) ? "Sports" : "Politics",
    closed: false,
    active: true,
    volume: volumeForIndex(index),
    volumeNum: volumeForIndex(index),
    volume24hr: volumeForIndex(index),
    startDate: "2026-06-01T00:00:00Z",
    endDate: "2026-06-01T03:00:00Z",
    markets: [
      {
        id: `market-${index + 1}`,
        conditionId: `condition-${index + 1}`,
        question: sportForIndex(index) ? `NBA market ${index + 1}` : `Election market ${index + 1}`,
        slug: sportForIndex(index) ? `nba-market-${index + 1}` : `election-market-${index + 1}`,
        active: true,
        acceptingOrders: true,
        enableOrderBook: true,
        clobTokenIds: [`yes-${index + 1}`, `no-${index + 1}`],
        outcomes: ["YES", "NO"],
        outcomePrices: [0.55, 0.45],
        bestAsk: 0.55,
        volume: 5000,
        volume24h: 100,
        liquidity: 200,
        tags: sportForIndex(index) ? [{ label: "NBA" }] : [{ label: "Politics" }],
        category: sportForIndex(index) ? "Sports" : "Politics",
      },
    ],
  }));
}

function makeGammaEvent(index: number, options: { sport?: boolean; volume?: number; title?: string; category?: string; series?: unknown } = {}) {
  const sport = options.sport ?? true;
  const volume = options.volume ?? 5000;
  const title = options.title ?? (sport ? `NBA event ${index}` : `Election event ${index}`);
  const category = options.category ?? (sport ? "Sports" : "Politics");
  return {
    id: `event-${index}`,
    slug: sport ? `nba-event-${index}` : `politics-event-${index}`,
    title,
    category,
    series: options.series,
    closed: false,
    active: true,
    volume,
    volumeNum: volume,
    volume24hr: volume,
    startDate: "2026-06-01T00:00:00Z",
    markets: [
      {
        id: `market-${index}`,
        conditionId: `condition-${index}`,
        question: sport ? `NBA market ${index}` : `Election market ${index}`,
        slug: sport ? `nba-market-${index}` : `election-market-${index}`,
        active: true,
        acceptingOrders: true,
        enableOrderBook: true,
        clobTokenIds: [`yes-${index}`, `no-${index}`],
        outcomes: ["YES", "NO"],
        outcomePrices: [0.55, 0.45],
        bestAsk: 0.55,
        volume,
        volume24h: volume,
        liquidity: 200,
        tags: sport ? [{ label: "NBA" }] : [{ label: "Politics" }],
        category,
      },
    ],
  };
}

async function callMarketsApi(query = "") {
  const { GET } = await import("@/app/api/polymarket/markets/route");
  const response = await GET(new Request(`http://localhost/api/polymarket/markets${query}`));
  return response.json();
}

async function callCountsApi() {
  const { GET } = await import("@/app/api/polymarket/markets/counts/route");
  const response = await GET(new Request("http://localhost/api/polymarket/markets/counts"));
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

  it("fetches broad Gamma events and respects limit and offset", async () => {
    const requestedUrls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      requestedUrls.push(String(input));
      return new Response(JSON.stringify(makeGammaEventPage(0, 3)), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const payload = await callMarketsApi("?limit=1&offset=1");

    expect(payload.limit).toBe(1);
    expect(payload.offset).toBe(1);
    expect(payload.returned).toBe(1);
    expect(payload.total).toBe(3);
    expect(payload.markets[0].id).toBe("condition-2");
    const params = new URL(requestedUrls[0]).searchParams;
    expect(params.get("series_id")).toBeNull();
    expect(params.get("active")).toBe("true");
    expect(params.get("closed")).toBe("false");
    expect(params.get("order")).toBe("volume");
    expect(params.get("ascending")).toBe("false");
    expect(params.get("limit")).toBe("100");
    expect(params.get("offset")).toBe("0");
    expect(payload.rawFetched).toBe(3);
    expect(payload.sportsMatched).toBe(3);
    expect(payload.volumeMatched).toBe(3);
    expect(payload.pagesFetched).toBe(1);
    expect(payload.stopReason).toBe("end");
  });

  it("continues pagination when early raw pages have few sports matches", async () => {
    const pages = [
      Array.from({ length: 100 }, (_, index) => makeGammaEvent(index, { sport: index === 5, volume: 5000 })),
      Array.from({ length: 100 }, (_, index) => makeGammaEvent(index + 100, { sport: index === 20, volume: index === 20 ? 1500 : 5000 })),
      [
        makeGammaEvent(200, { sport: true, volume: 7000, title: "WNBA finals winner", category: "Basketball", series: [{ title: "WNBA" }] }),
        makeGammaEvent(201, { sport: true, volume: 3000, title: "F1 Monaco Grand Prix winner", category: "Racing" }),
        makeGammaEvent(202, { sport: false, volume: 9000 }),
      ],
    ];
    const requestedUrls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      requestedUrls.push(String(input));
      return new Response(JSON.stringify(pages.shift() ?? []), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const payload = await callMarketsApi("?limit=10");

    expect(payload.rawFetched).toBe(203);
    expect(payload.sportsMatched).toBe(4);
    expect(payload.volumeMatched).toBe(3);
    expect(payload.pagesFetched).toBe(3);
    expect(payload.stopReason).toBe("end");
    expect(payload.total).toBe(3);
    expect(payload.markets.map((item: TerminalMarket) => item.id)).toEqual(["condition-200", "condition-5", "condition-201"]);
    expect(new URL(requestedUrls[0]).searchParams.get("offset")).toBe("0");
    expect(new URL(requestedUrls[1]).searchParams.get("offset")).toBe("100");
    expect(new URL(requestedUrls[2]).searchParams.get("offset")).toBe("200");
  });

  it("returns a cold first page without starting cached count warmup", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("offset=0")) {
        return Promise.resolve(new Response(JSON.stringify(makeGammaEventPage(0, 100, (index) => (index === 99 ? 1500 : 5000))), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const startedAt = Date.now();
    const payload = await callMarketsApi("?limit=1");
    const durationMs = Date.now() - startedAt;

    expect(durationMs).toBeLessThan(500);
    expect(payload.countsLoading).toBe(false);
    expect(payload.returned).toBe(1);
    expect(fetchMock).toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("offset=100"))).toBe(true);
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

  it("does not require the snapshot cache after warmup", async () => {
    seedMarketSnapshotCache(discovery);

    const fetchMock = vi.fn(async () => new Response(JSON.stringify(makeGammaEventPage(0, 2)), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const payload = await callMarketsApi("?limit=1&offset=1");

    expect(payload.limit).toBe(1);
    expect(payload.offset).toBe(1);
    expect(payload.returned).toBe(1);
    expect(payload.total).toBe(2);
    expect(payload.markets[0].id).toBe("condition-2");
    expect(fetchMock).toHaveBeenCalled();
  });

  it("excludes markets below the default minVolume and includes markets equal to it", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(makeGammaEventPage(0, 2, (index) => (index === 0 ? 1500 : 2000))), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const payload = await callMarketsApi();

    expect(payload.total).toBe(1);
    expect(payload.markets[0].id).toBe("condition-2");
  });

  it("respects the minVolume query param", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(makeGammaEventPage(0, 2, (index) => (index === 0 ? 2000 : 3000))), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const payload = await callMarketsApi("?minVolume=3000");

    expect(payload.total).toBe(1);
    expect(payload.markets[0].id).toBe("condition-2");
  });

  it("defaults minVolume to 2000", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(makeGammaEventPage(0, 2, (index) => (index === 0 ? 1500 : 2000))), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const payload = await callMarketsApi();

    expect(payload.total).toBe(1);
    expect(payload.markets[0].id).toBe("condition-2");
  });

  it("fetches Gamma directly for filter changes instead of using the snapshot", async () => {
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
    expect(fetchMock.mock.calls.length).toBeGreaterThan(fetchesAfterFirst);
  });

  it("keeps minVolume in load more requests", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(makeGammaEventPage(0, 3)), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const payload = await callMarketsApi("?limit=1&offset=1&minVolume=2000");

    expect(payload.limit).toBe(1);
    expect(payload.offset).toBe(1);
    expect(payload.total).toBe(3);
    expect(payload.markets[0].id).toBe("condition-2");
  });
});
