import { memoizeAsync } from "./enrichmentCache";
import type { EnrichedMarketSport } from "./enrichmentTypes";
import type { MarketResolverContext } from "./sportsResolverService";
import { similarityScore } from "./sportsResolverService";
import { fetchFixtureOdds } from "./sportmonksService";

type TheOddsApiEvent = {
  id?: string;
  sport_key?: string;
  sport_title?: string;
  commence_time?: string;
  home_team?: string;
  away_team?: string;
  bookmakers?: Array<{
    key?: string;
    title?: string;
    markets?: Array<{
      key?: string;
      outcomes?: Array<{
        name?: string;
        price?: number;
      }>;
    }>;
  }>;
};

type OddsComparisonResult = {
  provider: string;
  bookmakerAverageProbability?: number;
  bestBookmakerOdds?: number;
  polymarketProbability?: number;
  edge?: number;
  label?: "undervalued" | "overpriced" | "neutral";
};

const BASE_URL = "https://api.the-odds-api.com/v4";

function apiKey() {
  return process.env.ODDS_API_KEY?.trim() || "";
}

function hasOddsApi() {
  return Boolean(apiKey());
}

function sportKeyForMarket(sport: EnrichedMarketSport) {
  if (sport === "nba") return "basketball_nba";
  if (sport === "nfl") return "americanfootball_nfl";
  if (sport === "tennis") return "tennis_atp_wta";
  if (sport === "ufc") return "mma_mixed_martial_arts";
  return "";
}

async function fetchTheOddsApiEventOdds(sport: EnrichedMarketSport) {
  const sportKey = sportKeyForMarket(sport);
  if (!sportKey || !hasOddsApi()) return [];
  const url = new URL(`${BASE_URL}/sports/${sportKey}/odds`);
  url.searchParams.set("apiKey", apiKey());
  url.searchParams.set("regions", "us");
  url.searchParams.set("markets", "h2h");
  url.searchParams.set("oddsFormat", "decimal");
  url.searchParams.set("dateFormat", "iso");
  const response = await fetch(url.toString(), { cache: "no-store" });
  if (!response.ok) throw new Error(`The Odds API request failed with ${response.status}`);
  return (await response.json()) as TheOddsApiEvent[];
}

function averageProbability(bookmakers: NonNullable<TheOddsApiEvent["bookmakers"]>) {
  const probabilities: number[] = [];
  let bestOdds = 0;
  for (const bookmaker of bookmakers) {
    const h2h = bookmaker.markets?.find((market) => market.key === "h2h");
    for (const outcome of h2h?.outcomes ?? []) {
      if (!Number.isFinite(outcome.price) || outcome.price === 0) continue;
      const probability = 1 / Number(outcome.price);
      probabilities.push(probability);
      bestOdds = Math.max(bestOdds, Number(outcome.price));
    }
  }
  if (!probabilities.length) return null;
  return {
    average: probabilities.reduce((sum, value) => sum + value, 0) / probabilities.length,
    bestOdds,
  };
}

function marketTeamCandidateNames(context: MarketResolverContext) {
  return context.canonicalTeams.length ? context.canonicalTeams : context.outcomes.map((outcome) => outcome.name).filter((outcome) => outcome && outcome.length > 1);
}

function eventMatchScore(event: TheOddsApiEvent, context: MarketResolverContext) {
  const teamNames = marketTeamCandidateNames(context);
  const eventNames = [event.home_team ?? "", event.away_team ?? "", event.sport_title ?? ""];
  const nameScore = teamNames.reduce((score, team) => score + Math.max(...eventNames.map((candidate) => similarityScore(team, candidate))), 0);
  const eventTime = event.commence_time ? new Date(event.commence_time).getTime() : NaN;
  const marketTime = context.startTime ? new Date(context.startTime).getTime() : NaN;
  const dateScore = Number.isFinite(eventTime) && Number.isFinite(marketTime) ? Math.max(0, 1 - Math.min(1, Math.abs(eventTime - marketTime) / (1000 * 60 * 60 * 24 * 7))) : 0;
  return nameScore + dateScore;
}

async function fetchTheOddsApiComparison(context: MarketResolverContext): Promise<OddsComparisonResult | null> {
  const sportKey = sportKeyForMarket(context.sport);
  if (!sportKey || !hasOddsApi()) return null;
  const events = await memoizeAsync<TheOddsApiEvent[]>(`the-odds-api:${sportKey}`, 2 * 60 * 1000, async () => fetchTheOddsApiEventOdds(context.sport));
  const bestEvent = events
    .map((event) => ({ event, score: eventMatchScore(event, context) }))
    .sort((left, right) => right.score - left.score)[0]?.event;
  if (!bestEvent) return null;

  const summary = averageProbability(bestEvent.bookmakers ?? []);
  if (!summary) return null;
  return {
    provider: "the_odds_api",
    bookmakerAverageProbability: summary.average,
    bestBookmakerOdds: summary.bestOdds || undefined,
  };
}

async function fetchSportmonksComparison(context: MarketResolverContext, fixtureId?: string | null) {
  if (context.sport !== "soccer") return null;
  if (!fixtureId) return null;
  const odds = await fetchFixtureOdds(fixtureId);
  if (!odds.length) return null;
  const probabilities: number[] = [];
  let bestOdds = 0;
  for (const odd of odds) {
    const probability = Number(String(odd.probability ?? "").replace("%", ""));
    if (Number.isFinite(probability)) probabilities.push(probability / 100);
    const decimalOdd = Number(odd.value);
    if (Number.isFinite(decimalOdd)) bestOdds = Math.max(bestOdds, decimalOdd);
  }
  if (!probabilities.length) return null;
  return {
    provider: "sportmonks",
    bookmakerAverageProbability: probabilities.reduce((sum, value) => sum + value, 0) / probabilities.length,
    bestBookmakerOdds: bestOdds || undefined,
  } satisfies OddsComparisonResult;
}

export async function fetchOddsComparison(input: {
  context: MarketResolverContext;
  polymarketProbability: number;
  fixtureId?: string | null;
}) {
  const sportmonks = await fetchSportmonksComparison(input.context, input.fixtureId);
  const theOddsApi = await fetchTheOddsApiComparison(input.context);
  const candidate = sportmonks ?? theOddsApi;
  if (!candidate) return null;
  const edge = typeof candidate.bookmakerAverageProbability === "number" ? candidate.bookmakerAverageProbability - input.polymarketProbability : undefined;
  const label =
    typeof edge === "number"
      ? edge >= 0.05
        ? "undervalued"
        : edge <= -0.05
          ? "overpriced"
          : "neutral"
      : "neutral";
  return {
    ...candidate,
    polymarketProbability: input.polymarketProbability,
    edge,
    label,
  } satisfies OddsComparisonResult;
}
