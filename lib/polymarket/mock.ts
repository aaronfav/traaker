import { opportunityScore } from "@/lib/analytics/scoring";
import type { MarketChartPoint, NormalizedOrderbook, Position, RecentTrade, TerminalMarket } from "./types";

const now = Date.now();

const baseMockMarkets: TerminalMarket[] = [
  {
    id: "nba-finals-game-7-winner",
    conditionId: "0xmocknba7",
    slug: "nba-finals-game-7-winner",
    title: "NBA Finals Game 7: Lakers vs Celtics",
    sport: "Basketball",
    league: "NBA",
    status: "live",
    startTime: new Date(now + 1000 * 60 * 42).toISOString(),
    endTime: new Date(now + 1000 * 60 * 60 * 3).toISOString(),
    yesPrice: 0.57,
    noPrice: 0.43,
    volume24h: 1_240_000,
    volume: 8_900_000,
    liquidity: 420_000,
    priceMove24h: 0.08,
    volume1wk: 5_400_000,
    volumeAcceleration: 1.61,
    spread: 0.02,
    recentTradesCount: 390,
    opportunityScore: 0,
    outcomes: { yes: "Lakers", no: "Celtics" },
    tokenIds: { yes: "1000000000000000000000000000000000000000000000000000000000000001", no: "1000000000000000000000000000000000000000000000000000000000000002" },
    source: "mock",
  },
  {
    id: "champions-league-final-total-goals",
    conditionId: "0xmockucl",
    slug: "champions-league-final-total-goals",
    title: "Champions League Final: Over 2.5 Goals",
    sport: "Soccer",
    league: "UCL",
    status: "upcoming",
    startTime: new Date(now + 1000 * 60 * 60 * 8).toISOString(),
    endTime: new Date(now + 1000 * 60 * 60 * 11).toISOString(),
    yesPrice: 0.49,
    noPrice: 0.51,
    volume24h: 820_000,
    volume: 5_200_000,
    liquidity: 310_000,
    priceMove24h: -0.05,
    volume1wk: 3_100_000,
    volumeAcceleration: 1.85,
    spread: 0.03,
    recentTradesCount: 260,
    opportunityScore: 0,
    outcomes: { yes: "Over 2.5", no: "Under 2.5" },
    tokenIds: { yes: "2000000000000000000000000000000000000000000000000000000000000001", no: "2000000000000000000000000000000000000000000000000000000000000002" },
    source: "mock",
  },
  {
    id: "nfl-week-one-chiefs-spread",
    conditionId: "0xmocknfl",
    slug: "nfl-week-one-chiefs-spread",
    title: "NFL Week 1: Chiefs -3.5",
    sport: "Football",
    league: "NFL",
    status: "upcoming",
    startTime: new Date(now + 1000 * 60 * 60 * 30).toISOString(),
    endTime: new Date(now + 1000 * 60 * 60 * 34).toISOString(),
    yesPrice: 0.53,
    noPrice: 0.47,
    volume24h: 540_000,
    volume: 3_600_000,
    liquidity: 280_000,
    priceMove24h: 0.03,
    volume1wk: 2_800_000,
    volumeAcceleration: 1.35,
    spread: 0.02,
    recentTradesCount: 180,
    opportunityScore: 0,
    outcomes: { yes: "Chiefs -3.5", no: "Field +3.5" },
    tokenIds: { yes: "3000000000000000000000000000000000000000000000000000000000000001", no: "3000000000000000000000000000000000000000000000000000000000000002" },
    source: "mock",
  },
  {
    id: "mlb-yankees-red-sox",
    conditionId: "0xmockmlb",
    slug: "mlb-yankees-red-sox",
    title: "MLB: Yankees beat Red Sox",
    sport: "Baseball",
    league: "MLB",
    status: "live",
    startTime: new Date(now - 1000 * 60 * 35).toISOString(),
    endTime: new Date(now + 1000 * 60 * 120).toISOString(),
    yesPrice: 0.62,
    noPrice: 0.38,
    volume24h: 360_000,
    volume: 2_100_000,
    liquidity: 190_000,
    priceMove24h: 0.11,
    volume1wk: 1_200_000,
    volumeAcceleration: 2.1,
    spread: 0.03,
    recentTradesCount: 210,
    opportunityScore: 0,
    outcomes: { yes: "Yankees", no: "Red Sox" },
    tokenIds: { yes: "4000000000000000000000000000000000000000000000000000000000000001", no: "4000000000000000000000000000000000000000000000000000000000000002" },
    source: "mock",
  },
];

export const mockMarkets: TerminalMarket[] = baseMockMarkets.map((market) => ({
  ...market,
  opportunityScore: opportunityScore({
    liquidity: market.liquidity,
    volume: market.volume24h,
    priceMove24h: market.priceMove24h,
    recentTrades: market.recentTradesCount,
    spread: market.spread,
    volumeAcceleration: market.volumeAcceleration,
  }),
}));

export function mockChart(seed = 0.52): MarketChartPoint[] {
  return Array.from({ length: 32 }, (_, index) => {
    const drift = Math.sin(index / 3) * 0.035 + Math.cos(index / 5) * 0.018;
    const yes = Math.max(0.05, Math.min(0.95, seed + drift));
    return {
      time: new Date(now - (31 - index) * 1000 * 60 * 30).toISOString(),
      yes,
      no: 1 - yes,
    };
  });
}

export const mockOrderbook: NormalizedOrderbook = {
  bids: [
    { price: 0.56, size: 2400, total: 2400 },
    { price: 0.55, size: 5100, total: 7500 },
    { price: 0.54, size: 8200, total: 15700 },
    { price: 0.53, size: 12100, total: 27800 },
  ],
  asks: [
    { price: 0.58, size: 2900, total: 2900 },
    { price: 0.59, size: 6400, total: 9300 },
    { price: 0.6, size: 10300, total: 19600 },
    { price: 0.61, size: 14200, total: 33800 },
  ],
  tickSize: "0.01",
  minOrderSize: "5",
  lastTradePrice: 0.57,
};

export const mockTrades: RecentTrade[] = [
  { id: "t1", side: "BUY", outcome: "YES", price: 0.57, size: 120, timestamp: new Date(now - 1000 * 60 * 4).toISOString() },
  { id: "t2", side: "SELL", outcome: "NO", price: 0.43, size: 80, timestamp: new Date(now - 1000 * 60 * 8).toISOString() },
  { id: "t3", side: "BUY", outcome: "YES", price: 0.56, size: 210, timestamp: new Date(now - 1000 * 60 * 15).toISOString() },
  { id: "t4", side: "BUY", outcome: "NO", price: 0.44, size: 95, timestamp: new Date(now - 1000 * 60 * 24).toISOString() },
];

export const mockPositions: Position[] = [
  { market: "NBA Finals Game 7: Lakers vs Celtics", outcome: "Lakers", shares: 210, avgPrice: 0.48, markPrice: 0.57, value: 119.7, unrealizedPnl: 18.9 },
  { market: "Champions League Final: Over 2.5 Goals", outcome: "Over 2.5", shares: 140, avgPrice: 0.51, markPrice: 0.49, value: 68.6, unrealizedPnl: -2.8 },
];
