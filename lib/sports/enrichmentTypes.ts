export type EnrichedMarketSport = "soccer" | "nba" | "nfl" | "ufc" | "tennis";

export type EnrichedMarketType = "winner" | "game" | "player_prop" | "tournament_winner" | "other";

export type EnrichedMarketParticipant = {
  name: string;
  normalizedName: string;
  logo?: string;
  country?: string;
  record?: string;
  ranking?: number;
  recentForm?: string[];
  stats?: Record<string, number | string>;
};

export type EnrichedMarket = {
  marketId: string;
  question: string;
  sport: EnrichedMarketSport;
  marketType: EnrichedMarketType;
  polymarket: {
    outcomes: {
      name: string;
      price: number;
      impliedProbability: number;
      logo?: string;
      flag?: string;
    }[];
    liquidity?: number;
    volume?: number;
    endDate?: string;
  };
  event?: {
    externalEventId?: string;
    provider?: "sportsdb" | "sportmonks";
    league?: string;
    startTime?: string;
    status?: "scheduled" | "live" | "finished";
    venue?: string;
    homeTeam?: string;
    awayTeam?: string;
    score?: string;
  };
  participants: EnrichedMarketParticipant[];
  context: {
    standings?: string;
    headToHead?: string;
    injuries?: string[];
    lastGames?: string[];
    tournamentPath?: string[];
    liveStats?: Record<string, number | string>;
  };
  oddsComparison?: {
    provider: string;
    bookmakerAverageProbability?: number;
    bestBookmakerOdds?: number;
    polymarketProbability?: number;
    edge?: number;
    label?: "undervalued" | "overpriced" | "neutral";
  };
  smartTags: string[];
  confidenceScore: number;
  lastUpdated: string;
  enrichmentStatus?: "matched" | "partial" | "unmatched";
};

export type MarketEnrichmentInput = {
  id?: string;
  conditionId?: string;
  slug?: string;
  title?: string;
  question?: string;
  sport?: string;
  league?: string;
  marketId?: string;
  category?: string;
  status?: string;
  startTime?: string;
  endTime?: string | null;
  volume?: number;
  volume24h?: number;
  liquidity?: number;
  marketUrl?: string;
  polymarketUrl?: string;
  tags?: unknown;
  series?: unknown;
  outcomes?:
    | Array<{
        name: string;
        price?: number;
        tokenId?: string;
        marketId?: string;
        conditionId?: string;
        bestBid?: number;
        bestAsk?: number;
        polymarketTeamLogoUrl?: string;
        polymarketParticipantLogoUrl?: string;
        outcomeLogoUrl?: string;
        teamDisplayName?: string;
      }>
    | {
        yes?: string;
        no?: string;
      };
  outcomeOptions?: Array<{
    name: string;
    price?: number;
    tokenId?: string;
    marketId?: string;
    conditionId?: string;
    bestBid?: number;
    bestAsk?: number;
    polymarketTeamLogoUrl?: string;
    polymarketParticipantLogoUrl?: string;
    outcomeLogoUrl?: string;
    teamDisplayName?: string;
  }>;
};

export type EnrichmentCacheValue<T> = {
  expiresAt: number;
  value?: T;
  promise?: Promise<T>;
};
