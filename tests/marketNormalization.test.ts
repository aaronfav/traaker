import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeGammaMarket } from "@/lib/polymarket/markets";

const validSportsMarket = {
  id: "123",
  conditionId: "0xabc",
  question: "NBA: Knicks beat Celtics?",
  slug: "nba-knicks-celtics",
  active: true,
  closed: false,
  enableOrderBook: true,
  outcomes: JSON.stringify(["Knicks", "Celtics"]),
  outcomePrices: JSON.stringify(["0.52", "0.48"]),
  clobTokenIds: JSON.stringify(["111", "222"]),
  volume24hr: 10000,
  volume1wk: 35000,
  liquidity: 50000,
  bestAsk: 0.53,
  bestBid: 0.51,
  eventStartTime: "2026-06-01T00:00:00Z",
  endDate: "2026-06-01T03:00:00Z",
  tags: JSON.stringify([{ label: "Sports" }]),
};

describe("normalizeGammaMarket", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-18T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("normalizes active sports markets from Gamma shape", () => {
    const market = normalizeGammaMarket(validSportsMarket);

    expect(market).not.toBeNull();
    expect(market?.conditionId).toBe("0xabc");
    expect(market?.tokenIds.yes).toBe("111");
    expect(market?.outcomes.no).toBe("Celtics");
    expect(market?.sport).toBe("Basketball");
    expect(market?.spread).toBeCloseTo(0.02);
  });

  it("filters inactive or non-sports markets", () => {
    expect(normalizeGammaMarket({ ...validSportsMarket, question: "Will it rain?", slug: "weather-rain", tags: JSON.stringify([]) })).toBeNull();
    expect(normalizeGammaMarket({ ...validSportsMarket, active: false })).toBeNull();
  });

  it("excludes closed markets", () => {
    expect(normalizeGammaMarket({ ...validSportsMarket, closed: true })).toBeNull();
  });

  it("excludes inactive markets", () => {
    expect(normalizeGammaMarket({ ...validSportsMarket, active: false })).toBeNull();
  });

  it("excludes markets missing clobTokenIds", () => {
    expect(normalizeGammaMarket({ ...validSportsMarket, clobTokenIds: JSON.stringify(["111"]) })).toBeNull();
    expect(normalizeGammaMarket({ ...validSportsMarket, clobTokenIds: undefined })).toBeNull();
  });

  it("excludes markets with invalid prices", () => {
    expect(normalizeGammaMarket({ ...validSportsMarket, outcomePrices: JSON.stringify(["bad", "0.48"]) })).toBeNull();
    expect(normalizeGammaMarket({ ...validSportsMarket, outcomePrices: JSON.stringify(["1", "0"]) })).toBeNull();
  });

  it("includes valid active sports markets", () => {
    expect(normalizeGammaMarket(validSportsMarket)).not.toBeNull();
  });

  it("classifies future startTime as upcoming", () => {
    expect(normalizeGammaMarket({ ...validSportsMarket, eventStartTime: "2026-05-19T12:00:00Z" })?.status).toBe("upcoming");
  });

  it("classifies past startTime with no close as live", () => {
    expect(normalizeGammaMarket({ ...validSportsMarket, eventStartTime: "2026-05-18T10:00:00Z", endDate: "2026-05-18T15:00:00Z" })?.status).toBe("live");
  });

  it("classifies ended markets as stale", () => {
    expect(normalizeGammaMarket({ ...validSportsMarket, eventStartTime: "2026-05-18T08:00:00Z", endDate: "2026-05-18T10:00:00Z" })?.status).toBe("stale");
  });

  it("classifies missing startTime as stale or unknown", () => {
    const market = normalizeGammaMarket({ ...validSportsMarket, eventStartTime: undefined, startDate: undefined, events: undefined });
    expect(market?.status).toBe("stale");
  });

  it("uses event-level startDate when market-level date is missing", () => {
    const market = normalizeGammaMarket({
      ...validSportsMarket,
      eventStartTime: undefined,
      startDate: undefined,
      events: [{ startDate: "2026-05-19T12:00:00Z", endDate: "2026-05-19T15:00:00Z", tags: [{ label: "Sports" }] }],
    });

    expect(market?.status).toBe("upcoming");
    expect(market?.startTime).toBe("2026-05-19T12:00:00.000Z");
  });
});
