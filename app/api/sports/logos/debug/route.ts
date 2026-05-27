import { NextResponse } from "next/server";
import { cleanOutcomeTeamCandidate, extractMarketTeams } from "@/lib/sports/marketTeamExtractor";
import { resolveSportsLogoWithDebug } from "@/lib/sports/logoResolver";
import { resolvePolymarketTeamLogo } from "@/lib/polymarket/teams";
import { logError } from "@/lib/server/logger";

export const runtime = "nodejs";

const POLYMARKET_UPLOAD_HOST = "https://polymarket-upload.s3.us-east-2.amazonaws.com/";

function normalizePolymarketLogoUrl(value: string | null | undefined) {
  const logo = value?.trim();
  if (!logo) return null;
  const hostIndex = logo.lastIndexOf(POLYMARKET_UPLOAD_HOST);
  if (hostIndex > 0) {
    return `${POLYMARKET_UPLOAD_HOST}${logo.slice(hostIndex + POLYMARKET_UPLOAD_HOST.length)}`;
  }
  return logo;
}

function parseTeams(value: string | null) {
  return (value ?? "")
    .split(",")
    .map((team) => team.trim())
    .filter(Boolean)
    .slice(0, 12);
}

export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const category = searchParams.get("category")?.trim() || "Soccer";
    const sport = searchParams.get("sport")?.trim() || category;
    const marketTitle = searchParams.get("market")?.trim() || searchParams.get("marketTitle")?.trim() || "";
    const teams = parseTeams(searchParams.get("teams"));

    const extraction = extractMarketTeams({
      marketTitle,
      category,
      sport,
      outcomes: teams,
    });

    const resolved = await Promise.all(
      teams.map(async (outcomeName) => {
        const canonicalTeam = extraction.outcomeTeamMap[outcomeName];
        const teamCandidates = [
          canonicalTeam,
          cleanOutcomeTeamCandidate(outcomeName),
          outcomeName,
        ]
          .filter((value): value is string => Boolean(value))
          .filter((value, index, values) => values.findIndex((item) => item.toLowerCase() === value.toLowerCase()) === index);

        let matchedPolymarketTeam: Awaited<ReturnType<typeof resolvePolymarketTeamLogo>>["match"] | null = null;
        let matchedPolymarketTeamLogoUrl: string | null = null;
        for (const candidate of teamCandidates) {
          const match = await resolvePolymarketTeamLogo(candidate);
          if (match.match && match.logoUrl) {
            matchedPolymarketTeam = match.match;
            matchedPolymarketTeamLogoUrl = match.logoUrl;
            break;
          }
        }

        const { result, debug } = await resolveSportsLogoWithDebug({
          category,
          sport,
          marketTitle,
          outcomeName,
          polymarketLogoUrl: matchedPolymarketTeamLogoUrl ?? undefined,
        });
        return { outcomeName, canonicalTeam, matchedPolymarketTeam, matchedPolymarketTeamLogoUrl, result, debug };
      }),
    );

    return NextResponse.json(
      {
        category,
        sport,
        marketTitle,
        extractedTeams: extraction.canonicalTeams,
        mappedOutcomes: extraction.outcomeTeamMap,
        normalizedInput: resolved.flatMap((item) => item.debug.normalizedInput),
        candidateQueries: [...new Set(resolved.flatMap((item) => item.debug.candidateQueries))],
        sportsMonksQueries: resolved.flatMap((item) => item.debug.sportsMonksQueries),
        sportsMonksMatches: resolved.flatMap((item) => item.debug.sportsMonksMatches),
        theSportsDbQueries: resolved.flatMap((item) => item.debug.theSportsDbQueries),
        theSportsDbMatches: resolved.flatMap((item) => item.debug.theSportsDbMatches),
        finalResults: resolved.map((item) => ({
          rawOutcomeLabel: item.outcomeName,
          outcomeName: item.outcomeName,
          matchedMarketTeam: item.canonicalTeam,
          matchedPolymarketTeam: item.matchedPolymarketTeam
            ? {
                id: item.matchedPolymarketTeam.record.id ?? null,
                providerId: item.matchedPolymarketTeam.record.providerId ?? null,
                name: item.matchedPolymarketTeam.record.name ?? null,
                abbreviation: item.matchedPolymarketTeam.record.abbreviation ?? null,
                alias: item.matchedPolymarketTeam.record.alias ?? null,
                logo: normalizePolymarketLogoUrl(item.matchedPolymarketTeamLogoUrl ?? item.matchedPolymarketTeam.record.logo ?? null),
                matchedBy: item.matchedPolymarketTeam.matchedBy,
              }
            : null,
          canonicalTeam: item.canonicalTeam,
          cleanedTeamCandidate: cleanOutcomeTeamCandidate(item.outcomeName) || null,
          genericLogoChosen: item.result.entityType === "fallback" || item.result.entityType === "non_team" || !item.result.logoUrl,
          finalLogoUrl: normalizePolymarketLogoUrl(item.result.logoUrl) ?? item.result.logoUrl,
          providerReason: item.result.acceptedReason ?? item.result.rejectionReason ?? null,
          ...item.result,
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    logError("api.sports.logos.debug", error);
    return NextResponse.json({ error: "Unable to debug sports logos." }, { status: 502 });
  }
}
