import { TEAM_ALIASES, TEAM_SUFFIX_PATTERN } from "@/lib/sports/teamAliases";
import { canonicalTeamName, cleanOutcomeTeamCandidate, compactTeamText, extractMarketTeams, isNonTeamOutcome, stripTeamSuffix } from "@/lib/sports/marketTeamExtractor";
import { countryFlagUrl, isClubTeamMarket, isNationalTeamMarket, resolveCountryTeam } from "@/lib/sports/countryTeams";
import { resolvePolymarketTeamLogo } from "@/lib/polymarket/teams";

export type SportsLogoProvider = "polymarket" | "sportsmonks" | "thesportsdb" | "local" | "fallback";
export type SportsLogoConfidence =
  | "exact_normalized_match"
  | "alias_match"
  | "league_team_match"
  | "provider_exact_name"
  | "provider_alias_name"
  | "provider_shortcode"
  | "fallback";
export type SportsLogoEntityType = "club_team" | "national_team" | "fallback" | "non_team";
export type SportsParticipantType = "team" | "player" | "driver" | "fighter" | "constructor" | "country" | "generic";

export type SportsLogoInput = {
  marketTitle?: string;
  outcomeName: string;
  sport?: string;
  category?: string;
  polymarketLogoUrl?: string;
  polymarketParticipantLogoUrl?: string;
  sportsMonksTeamId?: string | number;
  participantType?: SportsParticipantType;
};

export type SportsLogoResolution = {
  logoUrl: string | null;
  teamName: string;
  teamDisplayName: string;
  source: SportsLogoProvider;
  logoSource: SportsLogoProvider;
  confidence: SportsLogoConfidence;
  entityType: SportsLogoEntityType;
  normalizedInput: string;
  providerUsed: SportsLogoProvider;
  participantType?: SportsParticipantType;
  cacheHit?: boolean;
  lookupMs?: number;
  acceptedReason?: string;
  rejectionReason?: string;
};

type CacheEntry<T = SportsLogoResolution> = {
  expiresAt: number;
  value?: T;
  promise?: Promise<T>;
};

type LogoCacheStore = Map<string, CacheEntry>;
type LeagueCacheStore = Map<string, CacheEntry<Array<Record<string, unknown>>>>;
type SportsMonksTeamCacheStore = Map<string, CacheEntry<Array<SportsMonksTeamRecord>>>;

type SportsMonksTeamRecord = {
  id?: number | string;
  name?: string;
  image_path?: string | null;
  logo_path?: string | null;
  logo?: string | null;
  image?: string | null;
  short_code?: string | null;
};

export type SportsLogoDebugTrace = {
  normalizedInput: string[];
  candidateQueries: string[];
  sportsMonksQueries: Array<{ teamName: string; url: string }>;
  sportsMonksMatches: Array<{ query: string; responseTeams: string[]; matchedTeam: string | null; confidence: SportsLogoConfidence | null; logoUrl: string | null; rejectedReason?: string }>;
  theSportsDbQueries: Array<{ teamName: string; url: string }>;
  theSportsDbMatches: Array<{ query: string; responseTeams: string[]; matchedTeam: string | null; confidence: SportsLogoConfidence | null; logoUrl: string | null; rejectedReason?: string }>;
  finalResults: SportsLogoResolution[];
};

declare global {
  var __TRAAK_SPORTS_LOGO_CACHE__: LogoCacheStore | undefined;
  var __TRAAK_SPORTS_LEAGUE_LOGO_CACHE__: LeagueCacheStore | undefined;
  var __TRAAK_SPORTSMONKS_TEAM_LOGO_CACHE__: SportsMonksTeamCacheStore | undefined;
}

const LOGO_CACHE_VERSION = "v4";
const SUCCESS_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FALLBACK_CACHE_TTL_MS = 10 * 60 * 1000;
const THE_SPORTS_DB_BASE_URL = "https://www.thesportsdb.com/api/v1/json";
const SPORTSMONKS_FOOTBALL_BASE_URL = "https://api.sportmonks.com/v3/football";

const NON_TEAM_CATEGORIES = new Set(["UFC", "Tennis", "Market"]);

function getCache() {
  if (!globalThis.__TRAAK_SPORTS_LOGO_CACHE__) {
    globalThis.__TRAAK_SPORTS_LOGO_CACHE__ = new Map();
  }
  return globalThis.__TRAAK_SPORTS_LOGO_CACHE__;
}

function getLeagueCache() {
  if (!globalThis.__TRAAK_SPORTS_LEAGUE_LOGO_CACHE__) {
    globalThis.__TRAAK_SPORTS_LEAGUE_LOGO_CACHE__ = new Map();
  }
  return globalThis.__TRAAK_SPORTS_LEAGUE_LOGO_CACHE__;
}

function getSportsMonksTeamCache() {
  if (!globalThis.__TRAAK_SPORTSMONKS_TEAM_LOGO_CACHE__) {
    globalThis.__TRAAK_SPORTSMONKS_TEAM_LOGO_CACHE__ = new Map();
  }
  return globalThis.__TRAAK_SPORTSMONKS_TEAM_LOGO_CACHE__;
}

function compactText(value: string) {
  return compactTeamText(value);
}

function withoutTeamSuffix(value: string) {
  return stripTeamSuffix(value);
}

function createSportsLogoDebugTrace(): SportsLogoDebugTrace {
  return {
    normalizedInput: [],
    candidateQueries: [],
    sportsMonksQueries: [],
    sportsMonksMatches: [],
    theSportsDbQueries: [],
    theSportsDbMatches: [],
    finalResults: [],
  };
}

function logoDebugEnabled() {
  return process.env.NEXT_PUBLIC_LOGO_DEBUG === "1" || process.env.LOGO_DEBUG === "true" || process.env.LOGO_DEBUG === "1";
}

function logLogoDebug(message: string, payload: Record<string, unknown>) {
  if (!logoDebugEnabled()) return;
  console.info("[Traak] sports logo debug", { message, ...payload });
}

function publicProviderUrl(url: URL | string) {
  const next = new URL(String(url));
  next.searchParams.delete("api_token");
  return next.toString();
}

export function normalizeSportsLogoCategory(category?: string, sport?: string) {
  const value = compactText(`${category ?? ""} ${sport ?? ""}`);
  if (/\bnba|basketball|wnba\b/.test(value)) return "NBA";
  if (/\bnfl|american football|super bowl\b/.test(value)) return "NFL";
  if (/\bnhl|hockey\b/.test(value)) return "NHL";
  if (/\bmlb|baseball\b/.test(value)) return "MLB";
  if (/\bsoccer|premier league|champions league|ucl|epl|uefa|fifa|mls|laliga|serie a|bundesliga\b/.test(value)) return "Soccer";
  if (/\bufc|mma|fight|fighter|boxing\b/.test(value)) return "UFC";
  if (/\btennis|atp|wta|wimbledon|french open|us open|australian open\b/.test(value)) return "Tennis";
  if (/\bf1|formula 1|formula one|motorsport|racing\b/.test(value)) return "F1";
  if (/\bcricket|ipl\b/.test(value)) return "Cricket";
  return category || sport || "Market";
}

export function normalizeTeamName(outcomeName: string, marketTitle = "", category?: string, sport?: string) {
  return normalizeTeamCandidate(outcomeName, marketTitle, category, sport)?.teamName ?? null;
}

function normalizeTeamCandidate(outcomeName: string, marketTitle = "", category?: string, sport?: string): { teamName: string; confidence: SportsLogoConfidence } | null {
  const normalizedCategory = normalizeSportsLogoCategory(category, sport);
  if (NON_TEAM_CATEGORIES.has(normalizedCategory)) return null;

  const extraction = extractMarketTeams({ marketTitle, category, sport, outcomes: [outcomeName] });
  const extractedTeam = extraction.outcomeTeamMap[outcomeName];
  const cleanedOutcomeName = cleanOutcomeTeamCandidate(outcomeName) || outcomeName;
  if (extractedTeam) {
    const outcomeNormalized = withoutTeamSuffix(cleanedOutcomeName);
    return {
      teamName: extractedTeam,
      confidence: outcomeNormalized === withoutTeamSuffix(extractedTeam) ? "exact_normalized_match" : "alias_match",
    };
  }

  if (isNonTeamOutcome(outcomeName)) return null;

  const teamName = canonicalTeamName(cleanedOutcomeName, category, sport);
  if (!teamName) return null;

  const normalizedOutcome = withoutTeamSuffix(cleanedOutcomeName);
  const normalizedTeam = withoutTeamSuffix(teamName);
  return {
    teamName,
    confidence: normalizedOutcome === normalizedTeam ? "exact_normalized_match" : "alias_match",
  };
}

function sportsDbApiKey() {
  return process.env.THESPORTSDB_API_KEY?.trim() || (process.env.NODE_ENV === "test" ? "" : "123");
}

function sportsMonksApiKey() {
  return process.env.SPORTSMONKS_API_KEY?.trim() || "";
}

function sportsLogoResolution(input: {
  logoUrl: string | null;
  teamName: string;
  source: SportsLogoProvider;
  confidence: SportsLogoConfidence;
  entityType?: SportsLogoEntityType;
  participantType?: SportsParticipantType;
  normalizedInput?: string;
  cacheHit?: boolean;
  lookupMs?: number;
  acceptedReason?: string;
  rejectionReason?: string;
}): SportsLogoResolution {
  return {
    logoUrl: input.logoUrl,
    teamName: input.teamName,
    teamDisplayName: input.teamName,
    source: input.source,
    logoSource: input.source,
    confidence: input.confidence,
    entityType: input.entityType ?? (input.source === "fallback" ? "fallback" : "club_team"),
    normalizedInput: input.normalizedInput ?? input.teamName,
    providerUsed: input.source,
    ...(input.participantType ? { participantType: input.participantType } : {}),
    ...(typeof input.cacheHit === "boolean" ? { cacheHit: input.cacheHit } : {}),
    ...(typeof input.lookupMs === "number" ? { lookupMs: input.lookupMs } : {}),
    ...(input.logoUrl && input.acceptedReason ? { acceptedReason: input.acceptedReason } : {}),
    ...(!input.logoUrl && input.rejectionReason ? { rejectionReason: input.rejectionReason } : {}),
  };
}

function logoFromTeamRecord(team: Record<string, unknown>) {
  const badge = typeof team.strTeamBadge === "string" ? team.strTeamBadge : "";
  const logo = typeof team.strTeamLogo === "string" ? team.strTeamLogo : "";
  const currentBadge = typeof team.strBadge === "string" ? team.strBadge : "";
  const currentLogo = typeof team.strLogo === "string" ? team.strLogo : "";
  return badge || logo || currentBadge || currentLogo || null;
}

function logoFromSportsMonksRecord(team: SportsMonksTeamRecord) {
  const imagePath = typeof team.image_path === "string" ? team.image_path.trim() : "";
  const logoPath = typeof team.logo_path === "string" ? team.logo_path.trim() : "";
  const logo = typeof team.logo === "string" ? team.logo.trim() : "";
  const image = typeof team.image === "string" ? team.image.trim() : "";
  return imagePath || logoPath || logo || image || null;
}

function aliasMatchesTeamName(candidate: string, teamName: string) {
  const candidateKey = compactText(candidate);
  const candidateWithoutSuffix = withoutTeamSuffix(candidate);
  const target = compactText(teamName);
  const targetWithoutSuffix = withoutTeamSuffix(teamName);
  const aliased = TEAM_ALIASES[candidateKey] ?? TEAM_ALIASES[candidateWithoutSuffix];
  return Boolean(aliased && (compactText(aliased) === target || withoutTeamSuffix(aliased) === targetWithoutSuffix));
}

function confidenceAcceptedReason(confidence: SportsLogoConfidence) {
  switch (confidence) {
    case "provider_exact_name":
      return "provider_exact_name";
    case "provider_alias_name":
      return "provider_alias_name";
    case "provider_shortcode":
      return "provider_shortcode";
    case "league_team_match":
      return "provider_team_id";
    case "exact_normalized_match":
      return "exact_normalized_match";
    case "alias_match":
      return "alias_match";
    default:
      return undefined;
  }
}

function uniqueValues(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = compactText(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function clubLogoQueryCandidates(teamName: string) {
  const normalizedTeam = compactText(teamName);
  const suffixlessTeam = withoutTeamSuffix(teamName);
  const aliases = Object.entries(TEAM_ALIASES)
    .filter(([, canonical]) => compactText(canonical) === normalizedTeam || withoutTeamSuffix(canonical) === suffixlessTeam)
    .map(([alias]) => alias);

  return uniqueValues([
    teamName,
    suffixlessTeam,
    ...aliases,
    ...(suffixlessTeam && !/\bfc\b/i.test(suffixlessTeam) ? [`${suffixlessTeam} FC`] : []),
  ]).slice(0, 8);
}

function classifyLogoEntity(input: SportsLogoInput, normalizedCategory: string) {
  if (NON_TEAM_CATEGORIES.has(normalizedCategory) || isNonTeamOutcome(input.outcomeName)) {
    return { entityType: "non_team" as const, normalizedName: input.outcomeName.trim(), rejectionReason: "non-team outcome or category" };
  }

  const cleanedOutcome = cleanOutcomeTeamCandidate(input.outcomeName) || input.outcomeName;
  const country = resolveCountryTeam(cleanedOutcome);
  if (country && isClubTeamMarket(input.marketTitle, input.category, input.sport)) {
    return { entityType: "non_team" as const, normalizedName: country.name, rejectionReason: "country outcome in club-team market" };
  }
  if (country && (isNationalTeamMarket(input.marketTitle, input.category, input.sport) || normalizedCategory === "Soccer")) {
    return { entityType: "national_team" as const, normalizedName: country.name, country };
  }

  return { entityType: "club_team" as const, normalizedName: "" };
}

function teamRecordMatchConfidence(team: Record<string, unknown>, teamName: string, candidateConfidence: SportsLogoConfidence): SportsLogoConfidence | null {
  void candidateConfidence;
  const target = compactText(teamName);
  const name = compactText(String(team.strTeam ?? ""));
  const nameWithoutSuffix = name.replace(TEAM_SUFFIX_PATTERN, " ").replace(/\s+/g, " ").trim();
  const shortCode = compactText(String(team.strTeamShort ?? team.strTeamShortName ?? team.strShortName ?? team.strCode ?? team.short_code ?? ""));
  const alternates = String(team.strTeamAlternate ?? team.strAlternate ?? "")
    .split(",")
    .map(compactText)
    .filter(Boolean);
  const normalizedAlternates = alternates.map((item) => item.replace(TEAM_SUFFIX_PATTERN, " ").replace(/\s+/g, " ").trim());
  const targetWithoutSuffix = target.replace(TEAM_SUFFIX_PATTERN, " ").replace(/\s+/g, " ").trim();
  if (name === target || name === targetWithoutSuffix || nameWithoutSuffix === target || nameWithoutSuffix === targetWithoutSuffix) {
    return "provider_exact_name";
  }
  if (normalizedAlternates.includes(target) || normalizedAlternates.includes(targetWithoutSuffix)) return "provider_alias_name";
  if (aliasMatchesTeamName(String(team.strTeam ?? ""), teamName)) return "provider_alias_name";
  if (alternates.some((alternate) => aliasMatchesTeamName(alternate, teamName))) return "provider_alias_name";
  if (shortCode && aliasMatchesTeamName(shortCode, teamName)) return "provider_shortcode";
  return null;
}

function sportsMonksTeamMatchConfidence(team: SportsMonksTeamRecord, teamName: string, candidateConfidence: SportsLogoConfidence, providerTeamId?: string | number): SportsLogoConfidence | null {
  void candidateConfidence;
  const teamId = team.id === undefined || team.id === null ? "" : String(team.id);
  if (providerTeamId !== undefined && providerTeamId !== null && teamId && teamId === String(providerTeamId)) return "league_team_match";

  const target = compactText(teamName);
  const targetWithoutSuffix = withoutTeamSuffix(teamName);
  const name = compactText(team.name ?? "");
  const nameWithoutSuffix = withoutTeamSuffix(team.name ?? "");

  if (name === target || name === targetWithoutSuffix || nameWithoutSuffix === target || nameWithoutSuffix === targetWithoutSuffix) {
    return "provider_exact_name";
  }
  if (aliasMatchesTeamName(team.name ?? "", teamName)) return "provider_alias_name";
  if (team.short_code && aliasMatchesTeamName(team.short_code, teamName)) return "provider_shortcode";

  return null;
}

function logRejectedTeamMatches(teamName: string, teams: Array<Record<string, unknown>>, source: string) {
  if ((process.env.NODE_ENV !== "development" && process.env.TRAAK_DEBUG_SPORTS_LOGOS !== "1") || teams.length === 0) return;
  console.debug("[Traak] rejected sports logo matches", {
    query: teamName,
    source,
    candidates: teams.slice(0, 3).map((team) => ({
      team: team.strTeam,
      alternate: team.strTeamAlternate ?? team.strAlternate,
    })),
  });
}

function leagueNamesForContext(category: string, rawContext: string) {
  const context = compactText(rawContext);
  if (category === "NBA") return ["NBA"];
  if (category === "NFL") return ["NFL"];
  if (category === "NHL") return ["NHL"];
  if (category === "MLB") return ["MLB", "Major League Baseball"];
  if (category === "Cricket") return ["IPL", "Indian Premier League", "Cricket"];
  if (category !== "Soccer") return [];

  const leagues: string[] = [];
  if (/\bpremier league|epl|english\b/.test(context)) leagues.push("English Premier League");
  if (/\bserie a|italian|italy|juventus|inter milan|ac milan|napoli|roma\b/.test(context)) leagues.push("Italian Serie A");
  if (/\bla liga|laliga|spanish|spain|real madrid|barcelona|atletico\b/.test(context)) leagues.push("Spanish La Liga");
  if (/\bbundesliga|german|germany|bayern|dortmund|leverkusen\b/.test(context)) leagues.push("German Bundesliga");
  if (/\bligue 1|french|france|psg|paris\b/.test(context)) leagues.push("French Ligue 1");
  if (/\bmls|major league soccer\b/.test(context)) leagues.push("MLS");
  return [...new Set([...leagues, "English Premier League", "Spanish La Liga", "Italian Serie A", "German Bundesliga", "French Ligue 1", "MLS"])];
}

async function fetchLeagueTeams(apiKey: string, leagueName: string) {
  const cache = getLeagueCache();
  const cached = cache.get(leagueName);
  if (cached && cached.expiresAt > Date.now()) {
    if (cached.value) return cached.value;
    if (cached.promise) return cached.promise;
  }

  const promise = fetch(`${THE_SPORTS_DB_BASE_URL}/${encodeURIComponent(apiKey)}/search_all_teams.php?l=${encodeURIComponent(leagueName)}`, { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) return [];
      const data = (await response.json()) as { teams?: Array<Record<string, unknown>> | null };
      return Array.isArray(data.teams) ? data.teams : [];
    })
    .catch(() => []);

  cache.set(leagueName, { expiresAt: Date.now() + SUCCESS_CACHE_TTL_MS, promise });
  const value = await promise;
  cache.set(leagueName, { expiresAt: Date.now() + SUCCESS_CACHE_TTL_MS, value });
  return value;
}

async function searchSportsMonksTeams(apiKey: string, teamName: string, debug?: SportsLogoDebugTrace) {
  const cache = getSportsMonksTeamCache();
  const cacheKey = `${LOGO_CACHE_VERSION}:${compactText(teamName)}`;
  const cached = debug ? undefined : cache.get(cacheKey);
  if (!debug && cached && cached.expiresAt > Date.now()) {
    if (cached.value) return cached.value;
    if (cached.promise) return cached.promise;
  }

  const url = new URL(`${SPORTSMONKS_FOOTBALL_BASE_URL}/teams/search/${encodeURIComponent(teamName)}`);
  url.searchParams.set("api_token", apiKey);
  url.searchParams.set("select", "id,name,image_path,short_code");
  debug?.sportsMonksQueries.push({ teamName, url: publicProviderUrl(url) });
  logLogoDebug("sportsmonks_query", { teamName, url: publicProviderUrl(url) });

  const promise = fetch(url.toString(), { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) return [];
      const data = (await response.json()) as { data?: SportsMonksTeamRecord[] | SportsMonksTeamRecord | null };
      if (Array.isArray(data.data)) return data.data;
      return data.data ? [data.data] : [];
    })
    .catch(() => []);

  cache.set(cacheKey, { expiresAt: Date.now() + SUCCESS_CACHE_TTL_MS, promise });
  const value = await promise;
  cache.set(cacheKey, { expiresAt: Date.now() + SUCCESS_CACHE_TTL_MS, value });
  logLogoDebug("sportsmonks_response", { teamName, responseTeams: value.map((team) => team.name ?? team.short_code ?? "") });
  return value;
}

async function fetchSportsMonksTeamById(apiKey: string, teamId: string | number, debug?: SportsLogoDebugTrace) {
  const id = String(teamId).trim();
  if (!id) return null;

  const url = new URL(`${SPORTSMONKS_FOOTBALL_BASE_URL}/teams/${encodeURIComponent(id)}`);
  url.searchParams.set("api_token", apiKey);
  url.searchParams.set("select", "id,name,image_path,short_code");
  debug?.sportsMonksQueries.push({ teamName: id, url: publicProviderUrl(url) });
  logLogoDebug("sportsmonks_query", { teamName: id, provider: "sportsmonks", url: publicProviderUrl(url) });

  return fetch(url.toString(), { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) return null;
      const data = (await response.json()) as { data?: SportsMonksTeamRecord | SportsMonksTeamRecord[] | null };
      if (Array.isArray(data.data)) return data.data[0] ?? null;
      return data.data ?? null;
    })
    .catch(() => null);
}

async function fetchSportsMonksTeamLogo(
  teamName: string,
  category: string,
  candidateConfidence: SportsLogoConfidence,
  providerTeamId?: string | number,
  debug?: SportsLogoDebugTrace,
): Promise<SportsLogoResolution | null> {
  const apiKey = sportsMonksApiKey();
  if (!apiKey || category !== "Soccer") return null;

  if (providerTeamId !== undefined && providerTeamId !== null) {
    const team = await fetchSportsMonksTeamById(apiKey, providerTeamId, debug);
    if (team) {
      const confidence = sportsMonksTeamMatchConfidence(team, teamName, candidateConfidence, providerTeamId);
      const logoUrl = confidence ? logoFromSportsMonksRecord(team) : null;
      const resolvedTeamName = typeof team.name === "string" && team.name.trim() ? team.name.trim() : teamName;
      debug?.sportsMonksMatches.push({
        query: String(providerTeamId),
        responseTeams: [[team.name, team.short_code].filter(Boolean).join(" / ")],
        matchedTeam: confidence ? resolvedTeamName : null,
        confidence,
        logoUrl,
        ...(confidence ? (logoUrl ? {} : { rejectedReason: "matched provider team has no supported logo field" }) : { rejectedReason: "provider team id did not match requested team" }),
      });
      logLogoDebug("sportsmonks_match", { teamName, provider: "sportsmonks", query: providerTeamId, matchedTeam: confidence ? resolvedTeamName : null, confidence, logoUrl });
      if (confidence && logoUrl) {
        return sportsLogoResolution({
          logoUrl,
          teamName: resolvedTeamName,
          source: "sportsmonks",
          confidence,
          entityType: "club_team",
          participantType: "team",
          normalizedInput: teamName,
          acceptedReason: confidenceAcceptedReason(confidence),
        });
      }
    }
  }

  const queries = clubLogoQueryCandidates(teamName);
  debug?.candidateQueries.push(...queries);

  for (const query of queries) {
    const teams = await searchSportsMonksTeams(apiKey, query, debug);
    const match = teams
      .map((team) => ({ team, confidence: sportsMonksTeamMatchConfidence(team, teamName, candidateConfidence, providerTeamId) }))
      .find((item): item is { team: SportsMonksTeamRecord; confidence: SportsLogoConfidence } => item.confidence !== null);

    if (!match) {
      const rejectedReason = "no exact normalized, explicit alias, or provider team id match";
      debug?.sportsMonksMatches.push({
        query,
        responseTeams: teams.map((team) => [team.name, team.short_code].filter(Boolean).join(" / ")),
        matchedTeam: null,
        confidence: null,
        logoUrl: null,
        rejectedReason,
      });
      logLogoDebug("sportsmonks_rejected", { teamName, query, rejectedReason, responseTeams: teams.map((team) => team.name ?? team.short_code ?? "") });
      logRejectedTeamMatches(
        query,
        teams.map((team) => ({ strTeam: team.name, strAlternate: team.short_code })),
        "sportsmonks",
      );
      continue;
    }

    const logoUrl = logoFromSportsMonksRecord(match.team);
    const resolvedTeamName = typeof match.team.name === "string" && match.team.name.trim() ? match.team.name.trim() : teamName;
    debug?.sportsMonksMatches.push({
      query,
      responseTeams: teams.map((team) => [team.name, team.short_code].filter(Boolean).join(" / ")),
      matchedTeam: resolvedTeamName,
      confidence: match.confidence,
      logoUrl,
      ...(logoUrl ? {} : { rejectedReason: "matched provider team has no supported logo field" }),
    });
    logLogoDebug("sportsmonks_match", { teamName, query, matchedTeam: resolvedTeamName, confidence: match.confidence, logoUrl });
    if (logoUrl) {
      return sportsLogoResolution({
        logoUrl,
        teamName: resolvedTeamName,
        source: "sportsmonks",
        confidence: match.confidence,
        entityType: "club_team",
        participantType: "team",
        normalizedInput: teamName,
        acceptedReason: confidenceAcceptedReason(match.confidence),
      });
    }
  }

  if (queries.length === 0) {
    const rejectedReason = "no exact normalized, explicit alias, or provider team id match";
    debug?.sportsMonksMatches.push({
      query: teamName,
      responseTeams: [],
      matchedTeam: null,
      confidence: null,
      logoUrl: null,
      rejectedReason,
    });
  }
  return null;
}

async function fetchTheSportsDbLeagueTeamLogo(
  teamName: string,
  category: string,
  rawContext: string,
  candidateConfidence: SportsLogoConfidence,
  debug?: SportsLogoDebugTrace,
): Promise<SportsLogoResolution | null> {
  const apiKey = sportsDbApiKey();
  const leagueNames = leagueNamesForContext(category, rawContext);
  if (!apiKey || leagueNames.length === 0) return null;

  for (const leagueName of leagueNames) {
    debug?.theSportsDbQueries.push({
      teamName,
      url: `${THE_SPORTS_DB_BASE_URL}/<key>/search_all_teams.php?l=${encodeURIComponent(leagueName)}`,
    });
  }
  const teamLists = await Promise.all(leagueNames.map((leagueName) => fetchLeagueTeams(apiKey, leagueName)));
  const teams = teamLists.flat();
  const match = teams
    .map((team) => ({ team, confidence: teamRecordMatchConfidence(team, teamName, candidateConfidence) }))
    .find((item): item is { team: Record<string, unknown>; confidence: SportsLogoConfidence } => item.confidence !== null);
  if (!match) {
    const rejectedReason = "no exact normalized or explicit alias match in league search";
    debug?.theSportsDbMatches.push({
      query: teamName,
      responseTeams: teams.map((team) => String(team.strTeam ?? team.strAlternate ?? team.strTeamAlternate ?? "")),
      matchedTeam: null,
      confidence: null,
      logoUrl: null,
      rejectedReason,
    });
    logLogoDebug("thesportsdb_league_rejected", { teamName, rejectedReason, responseTeams: teams.slice(0, 8).map((team) => team.strTeam) });
    logRejectedTeamMatches(teamName, teams, "league");
    return null;
  }

  const logoUrl = logoFromTeamRecord(match.team);
  const resolvedTeamName = typeof match.team.strTeam === "string" && match.team.strTeam.trim() ? match.team.strTeam.trim() : teamName;
  debug?.theSportsDbMatches.push({
    query: teamName,
    responseTeams: teams.map((team) => String(team.strTeam ?? team.strAlternate ?? team.strTeamAlternate ?? "")),
    matchedTeam: resolvedTeamName,
    confidence: match.confidence,
    logoUrl,
    ...(logoUrl ? {} : { rejectedReason: "matched provider team has no supported artwork field" }),
  });
  logLogoDebug("thesportsdb_league_match", { teamName, matchedTeam: resolvedTeamName, confidence: match.confidence, logoUrl });
  return logoUrl
    ? sportsLogoResolution({
        logoUrl,
        teamName: resolvedTeamName,
        source: "thesportsdb",
        confidence: match.confidence,
        entityType: "club_team",
        participantType: "team",
        normalizedInput: teamName,
        acceptedReason: confidenceAcceptedReason(match.confidence),
      })
    : null;
}

async function fetchTheSportsDbTeamLogo(
  teamName: string,
  category: string,
  rawContext: string,
  candidateConfidence: SportsLogoConfidence,
  debug?: SportsLogoDebugTrace,
): Promise<SportsLogoResolution | null> {
  const apiKey = sportsDbApiKey();
  if (!apiKey) return null;

  const queries = clubLogoQueryCandidates(teamName);
  debug?.candidateQueries.push(...queries);

  for (const query of queries) {
    const url = `${THE_SPORTS_DB_BASE_URL}/${encodeURIComponent(apiKey)}/searchteams.php?t=${encodeURIComponent(query)}`;
    debug?.theSportsDbQueries.push({ teamName: query, url: `${THE_SPORTS_DB_BASE_URL}/<key>/searchteams.php?t=${encodeURIComponent(query)}` });
    logLogoDebug("thesportsdb_query", { teamName, query, url: `${THE_SPORTS_DB_BASE_URL}/<key>/searchteams.php?t=${encodeURIComponent(query)}` });
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) continue;

    const data = (await response.json()) as { teams?: Array<Record<string, unknown>> | null };
    const teams = Array.isArray(data.teams) ? data.teams : [];
    logLogoDebug("thesportsdb_response", { teamName, query, responseTeams: teams.map((team) => team.strTeam ?? team.strAlternate ?? team.strTeamAlternate ?? "") });
    const match = teams
      .map((team) => ({ team, confidence: teamRecordMatchConfidence(team, teamName, candidateConfidence) }))
      .find((item): item is { team: Record<string, unknown>; confidence: SportsLogoConfidence } => item.confidence !== null);
    if (!match) {
      const rejectedReason = "no exact normalized or explicit alias match";
      debug?.theSportsDbMatches.push({
        query,
        responseTeams: teams.map((team) => String(team.strTeam ?? team.strAlternate ?? team.strTeamAlternate ?? "")),
        matchedTeam: null,
        confidence: null,
        logoUrl: null,
        rejectedReason,
      });
      logLogoDebug("thesportsdb_rejected", { teamName, query, rejectedReason, responseTeams: teams.map((team) => team.strTeam ?? team.strAlternate ?? team.strTeamAlternate ?? "") });
      logRejectedTeamMatches(query, teams, "search");
      continue;
    }

    const logoUrl = logoFromTeamRecord(match.team);
    const resolvedTeamName = typeof match.team.strTeam === "string" && match.team.strTeam.trim() ? match.team.strTeam.trim() : teamName;
    debug?.theSportsDbMatches.push({
      query,
      responseTeams: teams.map((team) => String(team.strTeam ?? team.strAlternate ?? team.strTeamAlternate ?? "")),
      matchedTeam: resolvedTeamName,
      confidence: match.confidence,
      logoUrl,
      ...(logoUrl ? {} : { rejectedReason: "matched provider team has no supported artwork field" }),
    });
    logLogoDebug("thesportsdb_match", { teamName, query, matchedTeam: resolvedTeamName, confidence: match.confidence, logoUrl });
    if (logoUrl) {
      return sportsLogoResolution({
        logoUrl,
        teamName: resolvedTeamName,
        source: "thesportsdb",
        confidence: match.confidence,
        entityType: "club_team",
        normalizedInput: teamName,
        acceptedReason: confidenceAcceptedReason(match.confidence),
      });
    }
  }

  return fetchTheSportsDbLeagueTeamLogo(teamName, category, rawContext, candidateConfidence, debug);
}

async function resolveSportsLogoInternal(input: SportsLogoInput, debug?: SportsLogoDebugTrace, bypassCache = false): Promise<SportsLogoResolution> {
  const startedAt = Date.now();
  const category = normalizeSportsLogoCategory(input.category, input.sport);
  const entity = classifyLogoEntity(input, category);
  const participantType = input.participantType ?? null;
  const candidate = normalizeTeamCandidate(input.outcomeName, input.marketTitle, input.category, input.sport);
  const teamName = candidate?.teamName ?? input.outcomeName.trim();
  const rawContext = `${input.category ?? ""} ${input.sport ?? ""} ${input.marketTitle ?? ""} ${input.outcomeName}`;
  logLogoDebug("logo_resolution_input", {
    marketTitle: input.marketTitle ?? null,
    outcomeName: input.outcomeName,
    category: input.category ?? null,
    sport: input.sport ?? null,
    polymarketLogoUrl: input.polymarketLogoUrl ?? null,
    polymarketParticipantLogoUrl: input.polymarketParticipantLogoUrl ?? null,
    sportsMonksTeamId: input.sportsMonksTeamId ?? null,
    participantType,
    normalizedCandidate: teamName,
    candidateConfidence: candidate?.confidence ?? null,
    entityType: entity.entityType,
    rejectionReason: entity.rejectionReason ?? null,
  });
  if (entity.entityType === "non_team") {
    const fallback = sportsLogoResolution({
      logoUrl: null,
      teamName: input.outcomeName.trim(),
      source: "fallback",
      confidence: "fallback",
      entityType: entity.entityType,
      ...(participantType ? { participantType } : {}),
      normalizedInput: input.outcomeName.trim(),
      rejectionReason: entity.rejectionReason ?? "no confident team candidate",
      cacheHit: true,
      lookupMs: Date.now() - startedAt,
    });
    debug?.normalizedInput.push(fallback.normalizedInput);
    debug?.finalResults.push(fallback);
    logLogoDebug("final_logo_result", { input, result: fallback });
    return fallback;
  }
  debug?.normalizedInput.push(teamName);

  const metadataLogoUrl = input.polymarketLogoUrl ?? input.polymarketParticipantLogoUrl ?? null;
  if (metadataLogoUrl) {
    const result = sportsLogoResolution({
      logoUrl: metadataLogoUrl,
      teamName,
      source: "polymarket",
      confidence: candidate?.confidence ?? "alias_match",
      entityType: entity.entityType,
      ...(participantType ? { participantType } : {}),
      normalizedInput: teamName,
      acceptedReason: "polymarket_metadata_logo",
      cacheHit: true,
      lookupMs: Date.now() - startedAt,
    });
    debug?.finalResults.push(result);
    logLogoDebug("market_metadata_logo_accepted", {
      marketTitle: input.marketTitle,
      outcomeName: input.outcomeName,
      selectedLogoUrl: result.logoUrl,
      normalizedInput: result.normalizedInput,
      entityType: result.entityType,
      confidence: result.confidence,
      acceptedReason: result.acceptedReason,
    });
    logLogoDebug("final_logo_result", { input, result });
    return result;
  }

  const teamLogoResolution = await resolvePolymarketTeamLogo(
    input.outcomeName,
    {
      category: input.category,
      sport: input.sport,
      marketTitle: input.marketTitle,
    },
    { includeTeamPageLookup: true },
  );
  logLogoDebug("teams_lookup_result", {
    marketTitle: input.marketTitle,
    outcomeName: input.outcomeName,
    teamLookupQuery: input.outcomeName,
    teamLookupCandidates: teamLogoResolution.debug.attempts.flatMap((attempt) => attempt.candidates).slice(0, 12),
    normalizedInput: teamLogoResolution.match?.normalizedQuery ?? teamName,
    matchedTeam: teamLogoResolution.match?.record.name ?? teamLogoResolution.match?.record.displayName ?? null,
    resolvedLogoUrl: teamLogoResolution.logoUrl,
    fallbackReason: teamLogoResolution.source === "teams" || teamLogoResolution.source === "team_page" ? null : teamLogoResolution.rejectionReason ?? "no /teams logo match",
    resolutionSource: teamLogoResolution.source,
    chosenCandidate: teamLogoResolution.debug.chosenCandidate,
    attempts: teamLogoResolution.debug.attempts,
  });
  if (teamLogoResolution.logoUrl && teamLogoResolution.match) {
    if (entity.entityType === "national_team" && entity.country) {
      logLogoDebug("provider_logo_rejected_for_national_team", {
        marketTitle: input.marketTitle,
        outcomeName: input.outcomeName,
        matchedTeam: teamLogoResolution.match.record.name ?? teamLogoResolution.match.record.displayName ?? null,
        resolvedLogoUrl: teamLogoResolution.logoUrl,
        resolutionSource: teamLogoResolution.source,
      });
    } else {
    const matchedBy = teamLogoResolution.match.matchedBy;
    const confidence: SportsLogoConfidence =
      matchedBy === "abbreviation"
        ? "provider_shortcode"
        : matchedBy === "alias" || matchedBy === "normalized_alias"
          ? "provider_alias_name"
          : "provider_exact_name";
    const result = sportsLogoResolution({
      logoUrl: teamLogoResolution.logoUrl,
      teamName: teamLogoResolution.match.record.displayName?.trim() || teamLogoResolution.match.record.name?.trim() || input.outcomeName.trim(),
      source: "polymarket",
      confidence,
      entityType: "club_team",
      ...(participantType ? { participantType } : {}),
      normalizedInput: teamLogoResolution.match.normalizedQuery,
      acceptedReason: "polymarket_teams_index",
      cacheHit: true,
      lookupMs: Date.now() - startedAt,
    });
    debug?.normalizedInput.push(result.normalizedInput);
    debug?.finalResults.push(result);
    logLogoDebug("final_logo_result", { input, result });
    return result;
    }
  }

  const sportsDbLogoResolution = await fetchTheSportsDbTeamLogo(teamName, category, rawContext, candidate?.confidence ?? "fallback", debug);
  logLogoDebug("sportsdb_lookup_result", {
    marketTitle: input.marketTitle,
    outcomeName: input.outcomeName,
    matchedTeam: sportsDbLogoResolution?.teamName ?? null,
    resolvedLogoUrl: sportsDbLogoResolution?.logoUrl ?? null,
    fallbackReason: sportsDbLogoResolution ? null : "no SportsDB match",
    resolutionSource: sportsDbLogoResolution?.source ?? null,
  });
  if (sportsDbLogoResolution?.logoUrl) {
    if (entity.entityType === "national_team" && entity.country) {
      logLogoDebug("provider_logo_rejected_for_national_team", {
        marketTitle: input.marketTitle,
        outcomeName: input.outcomeName,
        matchedTeam: sportsDbLogoResolution.teamName,
        resolvedLogoUrl: sportsDbLogoResolution.logoUrl,
        resolutionSource: sportsDbLogoResolution.source,
      });
    } else {
    debug?.finalResults.push(sportsDbLogoResolution);
    logLogoDebug("final_logo_result", { input, result: sportsDbLogoResolution });
    return sportsDbLogoResolution;
    }
  }

  const sportsMonksLogoResolution = await fetchSportsMonksTeamLogo(teamName, category, candidate?.confidence ?? "fallback", input.sportsMonksTeamId, debug);
  logLogoDebug("sportmonks_lookup_result", {
    marketTitle: input.marketTitle,
    outcomeName: input.outcomeName,
    matchedTeam: sportsMonksLogoResolution?.teamName ?? null,
    resolvedLogoUrl: sportsMonksLogoResolution?.logoUrl ?? null,
    fallbackReason: sportsMonksLogoResolution ? null : "no SportMonks match",
    resolutionSource: sportsMonksLogoResolution?.source ?? null,
  });
  if (sportsMonksLogoResolution?.logoUrl) {
    if (entity.entityType === "national_team" && entity.country) {
      logLogoDebug("provider_logo_rejected_for_national_team", {
        marketTitle: input.marketTitle,
        outcomeName: input.outcomeName,
        matchedTeam: sportsMonksLogoResolution.teamName,
        resolvedLogoUrl: sportsMonksLogoResolution.logoUrl,
        resolutionSource: sportsMonksLogoResolution.source,
      });
    } else {
    debug?.finalResults.push(sportsMonksLogoResolution);
    logLogoDebug("final_logo_result", { input, result: sportsMonksLogoResolution });
    return sportsMonksLogoResolution;
    }
  }

  if (entity.entityType === "national_team" && entity.country) {
    const result = sportsLogoResolution({
      logoUrl: countryFlagUrl(entity.country),
      teamName: entity.country.name,
      source: "local",
      confidence: "alias_match",
      entityType: "national_team",
      participantType: "country",
      normalizedInput: entity.country.name,
      acceptedReason: "country_flag",
      cacheHit: true,
      lookupMs: Date.now() - startedAt,
    });
    debug?.normalizedInput.push(result.normalizedInput);
    debug?.candidateQueries.push(entity.country.name);
    debug?.finalResults.push(result);
    logLogoDebug("final_logo_result", { input, result });
    return result;
  }

  const fallback = sportsLogoResolution({
    logoUrl: null,
    teamName,
    source: "fallback",
    confidence: "fallback",
    entityType: entity.entityType,
    ...(participantType ? { participantType } : {}),
    normalizedInput: teamLogoResolution.match?.normalizedQuery ?? teamName,
    rejectionReason: teamLogoResolution.rejectionReason ?? "no /teams logo match",
    cacheHit: true,
    lookupMs: Date.now() - startedAt,
  });
  logLogoDebug("logo_fallback", {
    marketTitle: input.marketTitle,
    outcomeName: input.outcomeName,
    matchedTeam: teamLogoResolution.match?.record.name ?? teamLogoResolution.match?.record.displayName ?? null,
    resolvedLogoUrl: teamLogoResolution.logoUrl,
    fallbackReason: teamLogoResolution.rejectionReason ?? "no /teams logo match",
    resolutionSource: teamLogoResolution.source,
  });
  debug?.finalResults.push(fallback);
  logLogoDebug("final_logo_result", { input: { ...input, resolvedTeamName: teamName }, result: fallback });
  return fallback;
}

export async function resolveSportsLogo(input: SportsLogoInput): Promise<SportsLogoResolution> {
  return resolveSportsLogoInternal(input);
}

export async function resolveSportsLogoWithDebug(input: SportsLogoInput) {
  const debug = createSportsLogoDebugTrace();
  const result = await resolveSportsLogoInternal(input, debug, true);
  return { result, debug };
}

export async function resolveSportsLogosForTeams(category: string, teams: string[], marketTitle = "") {
  return Promise.all(
    teams.map(async (team) => ({
      query: team,
      ...(await resolveSportsLogo({ category, marketTitle, outcomeName: team })),
    })),
  );
}

export function resetSportsLogoCache() {
  globalThis.__TRAAK_SPORTS_LOGO_CACHE__ = new Map();
  globalThis.__TRAAK_SPORTS_LEAGUE_LOGO_CACHE__ = new Map();
  globalThis.__TRAAK_SPORTSMONKS_TEAM_LOGO_CACHE__ = new Map();
}
