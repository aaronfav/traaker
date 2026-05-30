import { countryFlagUrl, resolveCountryTeam } from "./countryTeams";
import { memoizeAsync } from "./enrichmentCache";
import { buildPolymarketOutcomeSummary, normalizePolymarketMarket } from "./polymarketService";
import { fetchOddsComparison } from "./oddsService";
import { normalizeSportsEntityName, resolveBestEntity, type MarketResolverContext, type ResolvedEntityCandidate } from "./sportsResolverService";
import { getTeamRecentForm, searchPlayers, searchTeams as searchSportsDbTeams } from "./sportsDbService";
import { fetchLiveStandings, searchFixtures, searchTeams as searchSportmonksTeams } from "./sportmonksService";
import type { EnrichedMarket, EnrichedMarketParticipant, MarketEnrichmentInput } from "./enrichmentTypes";

type ProviderCandidate = ResolvedEntityCandidate & {
  provider: "sportsdb" | "sportmonks";
  kind: "team" | "player" | "fixture" | "event";
};

const FINAL_CACHE_TTL_MS = 60_000;

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function getPrimaryPolymarketProbability(outcomes: EnrichedMarket["polymarket"]["outcomes"]) {
  if (!outcomes.length) return 0;
  return outcomes.reduce((best, outcome) => Math.max(best, outcome.impliedProbability), 0);
}

function buildSmartTags(input: {
  market: MarketResolverContext;
  participants: EnrichedMarketParticipant[];
  oddsComparison?: EnrichedMarket["oddsComparison"];
  eventStatus?: NonNullable<EnrichedMarket["event"]>["status"];
}) {
  const tags = new Set<string>();
  const now = Date.now();
  const startMs = input.market.startTime ? new Date(input.market.startTime).getTime() : NaN;
  const hoursToStart = Number.isFinite(startMs) ? (startMs - now) / (1000 * 60 * 60) : NaN;
  const wins = input.participants.flatMap((participant) => participant.recentForm ?? []).filter((item) => item === "W").length;
  const losses = input.participants.flatMap((participant) => participant.recentForm ?? []).filter((item) => item === "L").length;

  if (input.eventStatus === "live" || input.market.question.toLowerCase().includes("live")) tags.add("Live Now");
  if (Number.isFinite(hoursToStart) && hoursToStart >= 0 && hoursToStart <= 12) tags.add("Starts Soon");
  if (wins >= 3 && wins > losses) tags.add("Hot Form");
  if (losses >= 3 && losses > wins) tags.add("Poor Form");
  if (input.participants.some((participant) => (participant.recentForm ?? []).filter((item) => item === "W").length >= 3)) tags.add("Strong Defense");
  if (/\b(over|under|totals?|points?|goals?|runs?)\b/i.test(input.market.question)) tags.add("High Scoring");
  if (input.market.question.toLowerCase().includes("home")) tags.add("Home Advantage");
  if (input.oddsComparison?.label === "undervalued") tags.add("Undervalued");
  if (input.oddsComparison?.label === "overpriced") tags.add("Overpriced");
  if (Number.isFinite(hoursToStart) && hoursToStart <= 48) tags.add("Market Moving");
  return [...tags];
}

function ordinalSuffix(value: number) {
  if (!Number.isFinite(value)) return "";
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return "th";
  switch (value % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

function buildContextSummary(standings: Array<{ teamName: string; position: number; points: number }>, participants: EnrichedMarketParticipant[]) {
  if (!standings.length) return undefined;
  const summaries = participants
    .map((participant) => {
      const match = standings.find((standing) => normalizeSportsEntityName(standing.teamName) === participant.normalizedName);
      if (!match) return null;
      return `${participant.name}: ${match.position}${ordinalSuffix(match.position)} - ${match.points} pts`;
    })
    .filter(Boolean);
  if (summaries.length) return summaries.join(" | ");
  const top = standings.slice(0, 3).map((standing) => `${standing.position}${ordinalSuffix(standing.position)} ${standing.teamName} (${standing.points})`);
  return top.length ? top.join(" | ") : undefined;
}

function buildParticipant(query: string, candidate: ProviderCandidate | null, league?: string): EnrichedMarketParticipant {
  const country = candidate?.country ? resolveCountryTeam(candidate.country)?.name ?? candidate.country : undefined;
  const countryRecord = candidate?.country ? resolveCountryTeam(candidate.country) : query ? resolveCountryTeam(query) : null;
  const stats: Record<string, number | string> = {};
  if (candidate?.venue) stats.venue = candidate.venue;
  if (candidate?.league) stats.league = candidate.league;
  if (candidate?.record) stats.record = candidate.record;
  if (candidate?.scoreText) stats.score = candidate.scoreText;
  if (league) stats.leagueContext = league;
  return {
    name: candidate?.name || query,
    normalizedName: normalizeSportsEntityName(candidate?.name || query),
    logo: candidate?.logo || (countryRecord ? countryFlagUrl(countryRecord) : undefined),
    country,
    ranking: candidate?.ranking,
    record: candidate?.record,
    recentForm: candidate?.form?.slice(0, 5),
    stats,
  };
}

async function resolveCandidates(context: MarketResolverContext) {
  const outcomeNames = context.outcomes.map((outcome) => outcome.name);
  const queries = [...new Set([...(context.canonicalTeams.length ? context.canonicalTeams : outcomeNames.slice(0, 2)), context.question].filter(Boolean))].slice(0, 4);
  const candidates: ProviderCandidate[] = [];
  const soccer = context.sport === "soccer";

  for (const query of queries) {
    const [sportsDbTeamResults, sportsDbPlayerResults, sportmonksTeamResults, sportmonksFixtureResults] = await Promise.allSettled([
      searchSportsDbTeams(query),
      context.marketType === "player_prop" || context.sport === "ufc" || context.sport === "tennis" ? searchPlayers(query) : Promise.resolve([]),
      soccer ? searchSportmonksTeams(query) : Promise.resolve([]),
      soccer ? searchFixtures(query) : Promise.resolve([]),
    ]);

    if (sportsDbTeamResults.status === "fulfilled") {
      for (const item of sportsDbTeamResults.value) candidates.push({ ...item, provider: "sportsdb", kind: "team" });
    }
    if (sportsDbPlayerResults.status === "fulfilled") {
      for (const item of sportsDbPlayerResults.value) candidates.push({ ...item, provider: "sportsdb", kind: "player" });
    }
    if (sportmonksTeamResults.status === "fulfilled") {
      for (const item of sportmonksTeamResults.value) candidates.push({ ...item, provider: "sportmonks", kind: "team" });
    }
    if (sportmonksFixtureResults.status === "fulfilled") {
      for (const item of sportmonksFixtureResults.value) candidates.push({ ...item, provider: "sportmonks", kind: "fixture" });
    }
  }

  return candidates;
}

function bestCandidateForQuery(query: string, candidates: ProviderCandidate[], context: MarketResolverContext) {
  const best = resolveBestEntity(query, candidates, { league: context.league, sport: context.sport, date: context.startTime ?? undefined });
  return best ? candidates.find((candidate) => candidate.id === best.id && candidate.name === best.name) ?? null : null;
}

function eventFromCandidate(candidate: ProviderCandidate | null, context: MarketResolverContext) {
  if (!candidate) return undefined;
  return {
    externalEventId: candidate.id ? String(candidate.id) : undefined,
    provider: candidate.provider,
    league: candidate.league || context.league,
    startTime: candidate.startTime || context.startTime,
    status: candidate.startTime ? (new Date(candidate.startTime).getTime() <= Date.now() ? "live" : "scheduled") : undefined,
    venue: candidate.venue,
    homeTeam: context.canonicalTeams[0] || candidate.name,
    awayTeam: context.canonicalTeams[1],
    score: candidate.scoreText,
  } as EnrichedMarket["event"];
}

export async function enrichMarket(input: MarketEnrichmentInput): Promise<EnrichedMarket> {
  const normalized = normalizePolymarketMarket(input);
  const marketId = String(input.id ?? input.marketId ?? (normalized.question || normalized.marketId || "market"));
  const cacheKey = `enriched-market:${marketId}`;

  return memoizeAsync(cacheKey, FINAL_CACHE_TTL_MS, async () => {
    const candidates = await resolveCandidates(normalized);
    const participantQueries = normalized.canonicalTeams.length ? normalized.canonicalTeams : normalized.outcomes.slice(0, 2).map((outcome) => outcome.name);
    const resolvedParticipants: EnrichedMarketParticipant[] = [];
    const participantCandidateList: ProviderCandidate[] = [];

    for (const query of participantQueries) {
      const candidate = bestCandidateForQuery(query, candidates, normalized);
      if (candidate) participantCandidateList.push(candidate);
      resolvedParticipants.push(buildParticipant(query, candidate, normalized.league));
    }

    const bestEventCandidate = candidates.find((candidate) => candidate.kind === "fixture") ?? participantCandidateList[0] ?? null;
    const event = eventFromCandidate(bestEventCandidate, normalized);
    const standings = event?.externalEventId && normalized.sport === "soccer" ? await fetchLiveStandings(event.league ?? "").catch(() => []) : [];
    const standingsSummary = buildContextSummary(standings, resolvedParticipants);

    const recentForms = await Promise.all(
      resolvedParticipants.map(async (participant, index) => {
        const original = participantCandidateList[index];
        if (!original?.id || original.provider !== "sportsdb") return participant.recentForm ?? [];
        return getTeamRecentForm(String(original.id), original.name).catch(() => participant.recentForm ?? []);
      }),
    );

    const participants = resolvedParticipants.map((participant, index) => ({
      ...participant,
      recentForm: recentForms[index]?.length ? recentForms[index] : participant.recentForm,
    }));

    const polymarketOutcomes = buildPolymarketOutcomeSummary(input);
    const primaryPolymarketProbability = getPrimaryPolymarketProbability(polymarketOutcomes);
    const oddsComparison = (await fetchOddsComparison({
      context: normalized,
      polymarketProbability: primaryPolymarketProbability,
      fixtureId: event?.externalEventId ?? null,
    }).catch(() => undefined)) ?? undefined;

    const context = {
      standings: standingsSummary,
      headToHead:
        participants.length >= 2
          ? `${participants[0].name}${participants[0].record ? ` (${participants[0].record})` : ""} vs ${participants[1].name}${participants[1].record ? ` (${participants[1].record})` : ""}`
          : undefined,
      injuries: [],
      lastGames: participants.flatMap((participant) => participant.recentForm ?? []).slice(0, 6),
      tournamentPath: normalized.marketType === "tournament_winner" ? ["Group stage", "Knockout rounds", "Final"] : undefined,
      liveStats: event?.score ? { score: event.score } : undefined,
    };

    const smartTags = buildSmartTags({
      market: normalized,
      participants,
      oddsComparison: oddsComparison ?? undefined,
      eventStatus: event?.status,
    });

    const confidenceScore = clamp(
      0.28 +
        (participants.some((participant) => participant.logo) ? 0.15 : 0) +
        (event ? 0.18 : 0) +
        (standingsSummary ? 0.12 : 0) +
        (oddsComparison ? 0.17 : 0),
    );

    const matchedSignals = [event, participants.some((participant) => participant.logo), oddsComparison, standingsSummary].filter(Boolean).length;
    const enrichmentStatus = matchedSignals === 0 ? "unmatched" : matchedSignals >= 3 ? "matched" : "partial";

    return {
      marketId,
      question: normalized.question,
      sport: normalized.sport,
      marketType: normalized.marketType,
      polymarket: {
        outcomes: polymarketOutcomes,
        liquidity: normalized.liquidity,
        volume: normalized.volume,
        endDate: normalized.endDate,
      },
      event,
      participants,
      context,
      oddsComparison,
      smartTags,
      confidenceScore,
      lastUpdated: new Date().toISOString(),
      enrichmentStatus,
    } satisfies EnrichedMarket;
  });
}
