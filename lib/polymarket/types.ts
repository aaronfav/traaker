export type MarketStatus = "live" | "upcoming" | "stale" | "closed";

export type TerminalMarket = {
  id: string;
  conditionId: string;
  slug: string;
  title: string;
  sport: string;
  league: string;
  status: MarketStatus;
  startTime: string;
  endTime: string | null;
  yesPrice: number;
  noPrice: number;
  volume24h: number;
  volume: number;
  liquidity: number;
  priceMove24h: number;
  volume1wk: number;
  volumeAcceleration: number;
  spread: number;
  bestBid?: number;
  bestAsk?: number;
  lastTradePrice?: number;
  recentTradesCount: number;
  opportunityScore: number;
  outcomes: {
    yes: string;
    no: string;
  };
  tokenIds: {
    yes: string;
    no: string;
  };
  image?: string;
  source: "polymarket" | "mock";
};

export type MarketChartPoint = {
  time: string;
  yes: number;
  no: number;
};

export type OrderbookLevel = {
  price: number;
  size: number;
  total: number;
};

export type NormalizedOrderbook = {
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  tickSize: string;
  minOrderSize: string;
  lastTradePrice: number;
};

export type RecentTrade = {
  id: string;
  side: "BUY" | "SELL";
  outcome: string;
  price: number;
  size: number;
  timestamp: string;
  txHash?: string;
};

export type Position = {
  market: string;
  outcome: string;
  shares: number;
  avgPrice: number;
  markPrice: number;
  value: number;
  unrealizedPnl: number;
};

export type AllowanceState = {
  balance: number;
  rawBalance: string;
  allowances: Record<string, string>;
  exchangeAllowance: string | null;
  ctfAllowance: string | null;
  hasExchangeAllowance: boolean;
  hasCtfAllowance: boolean;
};

export type PortfolioBalanceState = {
  usdc: AllowanceState;
  pUsd: AllowanceState | null;
  conditional: AllowanceState | null;
  source: "polymarket" | "mock";
};
