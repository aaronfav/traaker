import { canonicalTeamName, compactTeamText, extractMarketTeams, isNonTeamOutcome, stripTeamSuffix } from "@/lib/sports/marketTeamExtractor";
import { normalizeSportsLogoCategory } from "@/lib/sports/logoResolver";
import type { EnrichedMarketSport } from "./enrichmentTypes";

export type ResolvedEntityCandidate = {
  id?: string | number;
  name: string;
  slug?: string;
  league?: string;
  sport?: string;
  country?: string;
  venue?: string;
  startTime?: string;
  form?: string[];
  ranking?: number;
  record?: string;
  logo?: string;
  scoreText?: string;
};

export type ResolvedEntity = ResolvedEntityCandidate & {
  normalizedName: string;
  score: number;
  reason: string;
};

export type MarketResolverContext = {
  marketId: string;
  question: string;
  sport: EnrichedMarketSport;
  league?: string;
  startTime?: string;
  endTime?: string | null;
  outcomes: Array<{ name: string; price?: number }>;
  canonicalTeams: string[];
  marketType: "winner" | "game" | "player_prop" | "tournament_winner" | "other";
  isTeamMarket: boolean;
};

export function normalizeSportsEntityName(value: string) {
  return compactTeamText(value).replace(/\b(vs|versus|at)\b/g, " ").replace(/\s+/g, " ").trim();
}

export function similarityScore(a: string, b: string) {
  const left = normalizeSportsEntityName(a);
  const right = normalizeSportsEntityName(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return 0.88;

  const leftTokens = new Set(left.split(" ").filter(Boolean));
  const rightTokens = new Set(right.split(" ").filter(Boolean));
  const shared = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size || 1;
  const overlap = shared / union;
  return Math.max(overlap, 0);
}

export function resolveBestEntity(query: string, candidates: ResolvedEntityCandidate[], options?: { league?: string; sport?: string; date?: string }) {
  let best: ResolvedEntity | null = null;
  for (const candidate of candidates) {
    const nameScore = similarityScore(query, candidate.name);
    const leagueBoost = options?.league && candidate.league ? similarityScore(options.league, candidate.league) * 0.12 : 0;
    const sportBoost = options?.sport && candidate.sport ? similarityScore(options.sport, candidate.sport) * 0.08 : 0;
    const dateBoost = options?.date && candidate.startTime ? Math.max(0, 1 - Math.min(1, Math.abs(new Date(options.date).getTime() - new Date(candidate.startTime).getTime()) / (1000 * 60 * 60 * 24 * 7))) * 0.1 : 0;
    const total = nameScore + leagueBoost + sportBoost + dateBoost;
    if (!best || total > best.score) {
      best = {
        ...candidate,
        normalizedName: normalizeSportsEntityName(candidate.name),
        score: total,
        reason: nameScore >= 0.9 ? "exact" : nameScore >= 0.72 ? "fuzzy" : "weak",
      };
    }
  }
  return best;
}

export function resolveMarketContext(input: {
  marketId?: string;
  title?: string;
  question?: string;
  sport?: string;
  league?: string;
  startTime?: string;
  endTime?: string | null;
  outcomes?: Array<{ name: string; price?: number }>;
}) {
  const question = input.question?.trim() || input.title?.trim() || "";
  const normalizedSport = normalizeSportsLogoCategory(input.league, input.sport).toLowerCase() as EnrichedMarketSport;
  const marketTeams = extractMarketTeams({
    marketTitle: question,
    category: input.league,
    sport: input.sport,
    outcomes: input.outcomes?.map((outcome) => outcome.name) ?? [],
  });
  const outcomes = (input.outcomes ?? []).filter((outcome): outcome is { name: string; price?: number } => Boolean(outcome.name));
  const marketType = (() => {
    const text = compactTeamText(`${question} ${input.league ?? ""} ${input.sport ?? ""}`);
    if (/\b(to win|winner|wins?|champions?|outright|championship|title|tournament)\b/.test(text)) return text.includes("player") ? "player_prop" : "tournament_winner";
    if (/\b(points?|rebounds?|assists?|shots?|goals?|saves?|yards?|tds?|touchdowns?)\b/.test(text)) return "player_prop";
    if (marketTeams.isTeamOutcome || outcomes.length === 2) return "game";
    return "other";
  })();

  return {
    marketId: input.marketId ?? "",
    question,
    sport: normalizedSport,
    league: input.league?.trim() || undefined,
    startTime: input.startTime || undefined,
    endTime: input.endTime ?? undefined,
    outcomes,
    canonicalTeams: marketTeams.canonicalTeams,
    marketType,
    isTeamMarket: marketTeams.isTeamOutcome,
  } satisfies MarketResolverContext;
}

export function canonicalizeOutcomeName(outcomeName: string, marketLeague?: string, sport?: string) {
  return canonicalTeamName(outcomeName, marketLeague, sport) ?? (isNonTeamOutcome(outcomeName) ? null : stripTeamSuffix(outcomeName));
}
