import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeGammaMarket, normalizeGammaSportsEvent } from "@/lib/polymarket/markets";

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

  it("keeps real multi-outcome names, prices, and token ids together", () => {
    const market = normalizeGammaMarket({
      ...validSportsMarket,
      id: "ucl-winner",
      conditionId: "0xucl",
      question: "UEFA Champions League Winner",
      slug: "uefa-champions-league-winner",
      outcomes: JSON.stringify(["PSG", "Arsenal"]),
      outcomePrices: JSON.stringify([0.59, 0.43]),
      clobTokenIds: JSON.stringify(["psg-token", "arsenal-token"]),
      bestAsk: undefined,
      bestBid: undefined,
      tags: JSON.stringify([{ label: "Soccer" }, { label: "Champions League" }]),
    });

    expect(market).not.toBeNull();
    expect(market?.outcomes.yes).toBe("PSG");
    expect(market?.outcomes.no).toBe("Arsenal");
    expect(market?.yesPrice).toBe(0.59);
    expect(market?.noPrice).toBe(0.43);
    expect(market?.tokenIds.yes).toBe("psg-token");
    expect(market?.tokenIds.no).toBe("arsenal-token");
    expect(market?.outcomeOptions).toEqual([
      { name: "PSG", price: 0.59, tokenId: "psg-token", marketId: "ucl-winner", conditionId: "0xucl" },
      { name: "Arsenal", price: 0.43, tokenId: "arsenal-token", marketId: "ucl-winner", conditionId: "0xucl" },
    ]);
  });

  it("preserves binary sports matchup labels from JSON-encoded Gamma fields", () => {
    const market = normalizeGammaMarket({
      ...validSportsMarket,
      id: "gt-csk",
      conditionId: "0xipl",
      question: "Gujarat Titans vs Chennai Super Kings",
      slug: "gujarat-titans-vs-chennai-super-kings",
      outcomes: JSON.stringify(["Gujarat Titans", "Chennai Super Kings"]),
      outcomePrices: JSON.stringify(["0.57", "0.45"]),
      clobTokenIds: JSON.stringify(["101", "202"]),
      tags: JSON.stringify([{ label: "Cricket" }, { label: "Sports" }]),
    });

    expect(market).not.toBeNull();
    expect(market?.outcomeOptions).toEqual([
      { name: "Gujarat Titans", price: 0.57, tokenId: "101", marketId: "gt-csk", conditionId: "0xipl" },
      { name: "Chennai Super Kings", price: 0.45, tokenId: "202", marketId: "gt-csk", conditionId: "0xipl" },
    ]);
    expect(market?.outcomes.yes).toBe("Gujarat Titans");
    expect(market?.outcomes.no).toBe("Chennai Super Kings");
  });

  it("uses tokens outcome names when the outcomes array is missing", () => {
    const market = normalizeGammaMarket({
      ...validSportsMarket,
      question: "UEFA Champions League Winner",
      slug: "uefa-champions-league-winner",
      outcomes: undefined,
      outcomePrices: JSON.stringify([0.59, 0.43]),
      clobTokenIds: undefined,
      tokens: [
        { outcome: "PSG", token_id: "psg-token" },
        { outcome: "Arsenal", token_id: "arsenal-token" },
      ],
      tags: JSON.stringify([{ label: "Soccer" }, { label: "Champions League" }]),
    });

    expect(market).not.toBeNull();
    expect(market?.outcomeOptions?.map((outcome) => `${outcome.name}:${outcome.price}:${outcome.tokenId}`)).toEqual([
      "PSG:0.59:psg-token",
      "Arsenal:0.43:arsenal-token",
    ]);
  });

  it("preserves Polymarket outcome team logos from token metadata", () => {
    const market = normalizeGammaMarket({
      ...validSportsMarket,
      question: "UEFA Champions League Winner",
      slug: "uefa-champions-league-winner",
      outcomes: undefined,
      outcomePrices: JSON.stringify([0.59, 0.43]),
      clobTokenIds: undefined,
      tokens: [
        { outcome: "PSG", token_id: "psg-token", team: { name: "PSG", logo: "https://polymarket-upload.s3.us-east-2.amazonaws.com/psg.png" } },
        { outcome: "Arsenal", token_id: "arsenal-token", team: { name: "Arsenal", logo: "https://polymarket-upload.s3.us-east-2.amazonaws.com/arsenal.png" } },
      ],
      tags: JSON.stringify([{ label: "Soccer" }, { label: "Champions League" }]),
    });

    expect(market?.outcomeOptions).toMatchObject([
      { name: "PSG", polymarketTeamLogoUrl: "https://polymarket-upload.s3.us-east-2.amazonaws.com/psg.png" },
      { name: "Arsenal", polymarketTeamLogoUrl: "https://polymarket-upload.s3.us-east-2.amazonaws.com/arsenal.png" },
    ]);
  });

  it("prefers token outcome names over title-derived fallback outcomes", () => {
    const market = normalizeGammaMarket({
      ...validSportsMarket,
      question: "UEFA Champions League Winner",
      slug: "uefa-champions-league-winner",
      outcomes: JSON.stringify(["UEFA", "UEFA 2"]),
      outcomePrices: JSON.stringify([0.59, 0.43]),
      clobTokenIds: JSON.stringify(["psg-token", "arsenal-token"]),
      tokens: [
        { outcome: "PSG", token_id: "psg-token" },
        { outcome: "Arsenal", token_id: "arsenal-token" },
      ],
      tags: JSON.stringify([{ label: "Soccer" }, { label: "Champions League" }]),
    });

    expect(market?.outcomeOptions?.map((outcome) => outcome.name)).toEqual(["PSG", "Arsenal"]);
    expect(market?.outcomes.yes).toBe("PSG");
    expect(market?.outcomes.no).toBe("Arsenal");
  });

  it("aggregates multi-market winner events without losing child market token mapping", () => {
    const market = normalizeGammaSportsEvent({
      id: "ucl-event",
      slug: "uefa-champions-league-winner",
      title: "UEFA Champions League Winner",
      category: "Soccer",
      closed: false,
      active: true,
      volume: 100000,
      volume24hr: 25000,
      liquidity: 75000,
      startDate: "2026-06-01T00:00:00Z",
      tags: [{ label: "Sports" }, { label: "Champions League" }],
      markets: [
        {
          id: "psg-market",
          conditionId: "psg-condition",
          question: "Will PSG win the UEFA Champions League?",
          slug: "psg-ucl-winner",
          groupItemTitle: "PSG",
          active: true,
          acceptingOrders: true,
          enableOrderBook: true,
          outcomes: JSON.stringify(["Yes", "No"]),
          outcomePrices: JSON.stringify(["0.59", "0.41"]),
          clobTokenIds: JSON.stringify(["111111", "111112"]),
          bestBid: 0.58,
          bestAsk: 0.6,
          tags: [{ label: "Soccer" }],
        },
        {
          id: "arsenal-market",
          conditionId: "arsenal-condition",
          question: "Will Arsenal win the UEFA Champions League?",
          slug: "arsenal-ucl-winner",
          groupItemTitle: "Arsenal",
          active: true,
          acceptingOrders: true,
          enableOrderBook: true,
          outcomes: JSON.stringify(["Yes", "No"]),
          outcomePrices: JSON.stringify(["0.43", "0.57"]),
          clobTokenIds: JSON.stringify(["222221", "222222"]),
          bestBid: 0.42,
          bestAsk: 0.44,
          tags: [{ label: "Soccer" }],
        },
      ],
    });

    expect(market).not.toBeNull();
    expect(market?.title).toBe("UEFA Champions League Winner");
    expect(market?.outcomeOptions).toEqual([
      { name: "PSG", price: 0.59, tokenId: "111111", marketId: "psg-market", conditionId: "psg-condition", bestBid: 0.58, bestAsk: 0.6 },
      { name: "Arsenal", price: 0.43, tokenId: "222221", marketId: "arsenal-market", conditionId: "arsenal-condition", bestBid: 0.42, bestAsk: 0.44 },
    ]);
    expect(market?.outcomes.yes).toBe("PSG");
    expect(market?.outcomes.no).toBe("Arsenal");
    expect(market?.tokenIds.yes).toBe("111111");
    expect(market?.tokenIds.no).toBe("222221");
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
