import { deriveMarketCategory } from "@/lib/markets/category";
import { resolveMarketContext } from "./sportsResolverService";
import type { MarketEnrichmentInput } from "./enrichmentTypes";

function normalizeOutcomeList(input: MarketEnrichmentInput) {
  const explicit = Array.isArray(input.outcomes) ? input.outcomes : input.outcomeOptions ?? [];
  if (explicit.length > 0) return explicit;
  if (input.outcomes && !Array.isArray(input.outcomes) && "yes" in input.outcomes && "no" in input.outcomes) {
    const pair = input.outcomes as { yes?: string; no?: string };
    return [
      { name: pair.yes ?? "Yes", price: 0.5 },
      { name: pair.no ?? "No", price: 0.5 },
    ];
  }
  return [];
}

export function normalizePolymarketMarket(input: MarketEnrichmentInput) {
  const title = input.title ?? input.question ?? "";
  const question = input.question ?? input.title ?? title;
  const outcomes = normalizeOutcomeList(input).map((outcome) => ({ name: outcome.name, price: Number(outcome.price ?? 0) }));
  const category = deriveMarketCategory({
    title: question,
    sport: input.sport,
    league: input.league,
    category: input.category,
    tags: input.tags,
    series: input.series,
  });

  return {
    ...resolveMarketContext({
      marketId: input.id ?? input.marketId ?? "",
      title,
      question,
      sport: input.sport,
      league: input.league ?? category,
      startTime: input.startTime,
      endTime: input.endTime,
      outcomes,
    }),
    category,
    liquidity: Number(input.liquidity ?? 0),
    volume: Number(input.volume ?? input.volume24h ?? 0),
    endDate: input.endTime ?? undefined,
    outcomes,
  };
}

export function polymarketImpliedProbability(price: number) {
  return Math.max(0, Math.min(1, Number.isFinite(price) ? price : 0));
}

export function buildPolymarketOutcomeSummary(input: MarketEnrichmentInput) {
  return normalizeOutcomeList(input)
    .map((outcome) => ({
      name: outcome.name,
      price: Number(outcome.price ?? 0),
      impliedProbability: polymarketImpliedProbability(Number(outcome.price ?? 0)),
      logo: outcome.polymarketTeamLogoUrl ?? outcome.polymarketParticipantLogoUrl ?? outcome.outcomeLogoUrl ?? undefined,
      flag: undefined,
    }))
    .filter((outcome) => outcome.name);
}
