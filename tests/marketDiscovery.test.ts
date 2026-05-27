import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSportsMarkets } from "@/lib/polymarket/markets";

function gammaEvent(index: number) {
  return {
    id: String(index),
    slug: `nba-event-${index}`,
    title: `NBA event ${index}`,
    startTime: "2026-06-01T00:00:00Z",
    endDate: "2026-06-01T03:00:00Z",
    tags: [{ label: "Sports" }],
    markets: [
      {
        id: `market-${index}`,
        conditionId: `condition-${index}`,
        question: `NBA market ${index}`,
        slug: `nba-market-${index}`,
        active: true,
        closed: false,
        enableOrderBook: true,
        outcomes: JSON.stringify(["YES", "NO"]),
        outcomePrices: JSON.stringify(["0.52", "0.48"]),
        clobTokenIds: JSON.stringify([`yes-${index}`, `no-${index}`]),
      },
    ],
  };
}

describe("fetchSportsMarkets", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("paginates Gamma events until empty and does not cap filtered markets at 500", async () => {
    const pages = [
      Array.from({ length: 200 }, (_, index) => gammaEvent(index)),
      Array.from({ length: 200 }, (_, index) => gammaEvent(index + 200)),
      Array.from({ length: 101 }, (_, index) => gammaEvent(index + 400)),
      [],
    ];
    const requestedUrls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      requestedUrls.push(String(input));
      return new Response(JSON.stringify(pages.shift() ?? []), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    const markets = await fetchSportsMarkets();
    const eventUrls = requestedUrls.filter((url) => url.includes("/events"));

    expect(markets).toHaveLength(501);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(new URL(eventUrls[0]).searchParams.get("offset")).toBe("0");
    expect(new URL(eventUrls[1]).searchParams.get("offset")).toBe("200");
    expect(new URL(eventUrls[2]).searchParams.get("offset")).toBe("400");
    expect(new URL(eventUrls[3]).searchParams.get("offset")).toBe("501");
  });
});
