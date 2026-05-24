import { TEAM_ALIASES, TEAM_SUFFIX_PATTERN } from "@/lib/sports/teamAliases";

export type SportsLogoProvider = "sportsmonks" | "thesportsdb" | "local" | "fallback";
export type SportsLogoConfidence = "exact_normalized_match" | "alias_match" | "league_team_match" | "fallback";

export type SportsLogoInput = {
  marketTitle?: string;
  outcomeName: string;
  sport?: string;
  category?: string;
  sportsMonksTeamId?: string | number;
};

export type SportsLogoResolution = {
  logoUrl: string | null;
  teamName: string;
  teamDisplayName: string;
  source: SportsLogoProvider;
  logoSource: SportsLogoProvider;
  confidence: SportsLogoConfidence;
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
  short_code?: string | null;
};

declare global {
  var __TRAAK_SPORTS_LOGO_CACHE__: LogoCacheStore | undefined;
  var __TRAAK_SPORTS_LEAGUE_LOGO_CACHE__: LeagueCacheStore | undefined;
  var __TRAAK_SPORTSMONKS_TEAM_LOGO_CACHE__: SportsMonksTeamCacheStore | undefined;
}

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
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
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function titleCase(value: string) {
  const uppercaseWords = new Set(["afc", "cf", "fc", "psg", "sc", "ufc"]);
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => (uppercaseWords.has(word) ? word.toUpperCase() : `${word[0]?.toUpperCase() ?? ""}${word.slice(1).toLowerCase()}`))
    .join(" ");
}

function withoutTeamSuffix(value: string) {
  return compactText(value).replace(TEAM_SUFFIX_PATTERN, " ").replace(/\s+/g, " ").trim();
}

export function normalizeSportsLogoCategory(category?: string, sport?: string) {
  const value = compactText(`${category ?? ""} ${sport ?? ""}`);
  if (/\bnba|basketball|wnba\b/.test(value)) return "NBA";
  if (/\bnfl|american football|super bowl\b/.test(value)) return "NFL";
  if (/\bsoccer|premier league|champions league|ucl|epl|uefa|fifa|mls|laliga|serie a|bundesliga\b/.test(value)) return "Soccer";
  if (/\bufc|mma|fight|fighter|boxing\b/.test(value)) return "UFC";
  if (/\btennis|atp|wta|wimbledon|french open|us open|australian open\b/.test(value)) return "Tennis";
  return category || sport || "Market";
}

export function normalizeTeamName(outcomeName: string, marketTitle = "", category?: string, sport?: string) {
  return normalizeTeamCandidate(outcomeName, marketTitle, category, sport)?.teamName ?? null;
}

function normalizeTeamCandidate(outcomeName: string, marketTitle = "", category?: string, sport?: string): { teamName: string; confidence: SportsLogoConfidence } | null {
  const normalizedCategory = normalizeSportsLogoCategory(category, sport);
  if (NON_TEAM_CATEGORIES.has(normalizedCategory)) return null;

  const cleaned = compactText(outcomeName)
    .replace(/\b(to win|winner|wins?|moneyline|spread|market|yes|no|draw|tie|other|field|champions?|championship|advance|qualify)\b/g, " ")
    .replace(TEAM_SUFFIX_PATTERN, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || /^(yes|no|draw|tie|market|winner|other|field)$/.test(cleaned)) return null;

  const directAlias = TEAM_ALIASES[cleaned];
  if (directAlias) return { teamName: directAlias, confidence: directAlias.toLowerCase() === titleCase(cleaned).toLowerCase() ? "exact_normalized_match" : "alias_match" };

  const aliasKey = Object.keys(TEAM_ALIASES)
    .sort((a, b) => b.length - a.length)
    .find((alias) => alias === cleaned);
  if (aliasKey) return { teamName: TEAM_ALIASES[aliasKey], confidence: "alias_match" };

  const title = compactText(marketTitle);
  const titleAlias = Object.keys(TEAM_ALIASES)
    .sort((a, b) => b.length - a.length)
    .find((alias) => cleaned === alias || (title.includes(alias) && cleaned === withoutTeamSuffix(alias)));
  if (titleAlias) return { teamName: TEAM_ALIASES[titleAlias], confidence: "alias_match" };

  return { teamName: titleCase(cleaned), confidence: "exact_normalized_match" };
}

function sportsDbApiKey() {
  return process.env.THESPORTSDB_API_KEY?.trim() || (process.env.NODE_ENV === "test" ? "" : "123");
}

function sportsMonksApiKey() {
  return process.env.SPORTSMONKS_API_KEY?.trim() || "";
}

function sportsLogoResolution(input: { logoUrl: string | null; teamName: string; source: SportsLogoProvider; confidence: SportsLogoConfidence }): SportsLogoResolution {
  return {
    logoUrl: input.logoUrl,
    teamName: input.teamName,
    teamDisplayName: input.teamName,
    source: input.source,
    logoSource: input.source,
    confidence: input.confidence,
  };
}

function logoFromTeamRecord(team: Record<string, unknown>) {
  const badge = typeof team.strTeamBadge === "string" ? team.strTeamBadge : "";
  const logo = typeof team.strTeamLogo === "string" ? team.strTeamLogo : "";
  const currentBadge = typeof team.strBadge === "string" ? team.strBadge : "";
  const currentLogo = typeof team.strLogo === "string" ? team.strLogo : "";
  return badge || logo || currentBadge || currentLogo || null;
}

function teamRecordMatchConfidence(team: Record<string, unknown>, teamName: string, candidateConfidence: SportsLogoConfidence): SportsLogoConfidence | null {
  const target = compactText(teamName);
  const name = compactText(String(team.strTeam ?? ""));
  const alternates = String(team.strTeamAlternate ?? team.strAlternate ?? "")
    .split(",")
    .map(compactText)
    .filter(Boolean);
  const normalizedAlternates = alternates.map((item) => item.replace(TEAM_SUFFIX_PATTERN, " ").replace(/\s+/g, " ").trim());
  const targetWithoutSuffix = target.replace(TEAM_SUFFIX_PATTERN, " ").replace(/\s+/g, " ").trim();
  if (name === target || name === targetWithoutSuffix) return candidateConfidence === "alias_match" ? "alias_match" : "exact_normalized_match";
  if (normalizedAlternates.includes(target) || normalizedAlternates.includes(targetWithoutSuffix)) return "alias_match";
  return null;
}

function sportsMonksTeamMatchConfidence(team: SportsMonksTeamRecord, teamName: string, candidateConfidence: SportsLogoConfidence, providerTeamId?: string | number): SportsLogoConfidence | null {
  const teamId = team.id === undefined || team.id === null ? "" : String(team.id);
  if (providerTeamId !== undefined && providerTeamId !== null && teamId && teamId === String(providerTeamId)) return "league_team_match";

  const target = compactText(teamName);
  const targetWithoutSuffix = withoutTeamSuffix(teamName);
  const name = compactText(team.name ?? "");
  const nameWithoutSuffix = withoutTeamSuffix(team.name ?? "");

  if (name === target || name === targetWithoutSuffix || nameWithoutSuffix === target || nameWithoutSuffix === targetWithoutSuffix) {
    return candidateConfidence === "alias_match" ? "alias_match" : "exact_normalized_match";
  }

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

  cache.set(leagueName, { expiresAt: Date.now() + CACHE_TTL_MS, promise });
  const value = await promise;
  cache.set(leagueName, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  return value;
}

async function searchSportsMonksTeams(apiKey: string, teamName: string) {
  const cache = getSportsMonksTeamCache();
  const cacheKey = compactText(teamName);
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    if (cached.value) return cached.value;
    if (cached.promise) return cached.promise;
  }

  const url = new URL(`${SPORTSMONKS_FOOTBALL_BASE_URL}/teams/search/${encodeURIComponent(teamName)}`);
  url.searchParams.set("api_token", apiKey);
  url.searchParams.set("select", "id,name,image_path,short_code");

  const promise = fetch(url.toString(), { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) return [];
      const data = (await response.json()) as { data?: SportsMonksTeamRecord[] | SportsMonksTeamRecord | null };
      if (Array.isArray(data.data)) return data.data;
      return data.data ? [data.data] : [];
    })
    .catch(() => []);

  cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, promise });
  const value = await promise;
  cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  return value;
}

async function fetchSportsMonksTeamLogo(
  teamName: string,
  category: string,
  candidateConfidence: SportsLogoConfidence,
  providerTeamId?: string | number,
): Promise<SportsLogoResolution | null> {
  const apiKey = sportsMonksApiKey();
  if (!apiKey || category !== "Soccer") return null;

  const teams = await searchSportsMonksTeams(apiKey, teamName);
  const match = teams
    .map((team) => ({ team, confidence: sportsMonksTeamMatchConfidence(team, teamName, candidateConfidence, providerTeamId) }))
    .find((item): item is { team: SportsMonksTeamRecord; confidence: SportsLogoConfidence } => item.confidence !== null);

  if (!match) {
    logRejectedTeamMatches(
      teamName,
      teams.map((team) => ({ strTeam: team.name, strAlternate: team.short_code })),
      "sportsmonks",
    );
    return null;
  }

  const logoUrl = typeof match.team.image_path === "string" && match.team.image_path.trim() ? match.team.image_path.trim() : null;
  const resolvedTeamName = typeof match.team.name === "string" && match.team.name.trim() ? match.team.name.trim() : teamName;
  return logoUrl ? sportsLogoResolution({ logoUrl, teamName: resolvedTeamName, source: "sportsmonks", confidence: match.confidence }) : null;
}

async function fetchTheSportsDbLeagueTeamLogo(teamName: string, category: string, rawContext: string, candidateConfidence: SportsLogoConfidence): Promise<SportsLogoResolution | null> {
  const apiKey = sportsDbApiKey();
  const leagueNames = leagueNamesForContext(category, rawContext);
  if (!apiKey || leagueNames.length === 0) return null;

  const teamLists = await Promise.all(leagueNames.map((leagueName) => fetchLeagueTeams(apiKey, leagueName)));
  const teams = teamLists.flat();
  const match = teams
    .map((team) => ({ team, confidence: teamRecordMatchConfidence(team, teamName, candidateConfidence) }))
    .find((item): item is { team: Record<string, unknown>; confidence: SportsLogoConfidence } => item.confidence !== null);
  if (!match) {
    logRejectedTeamMatches(teamName, teams, "league");
    return null;
  }

  const logoUrl = logoFromTeamRecord(match.team);
  const resolvedTeamName = typeof match.team.strTeam === "string" && match.team.strTeam.trim() ? match.team.strTeam.trim() : teamName;
  return logoUrl ? sportsLogoResolution({ logoUrl, teamName: resolvedTeamName, source: "thesportsdb", confidence: match.confidence }) : null;
}

async function fetchTheSportsDbTeamLogo(teamName: string, category: string, rawContext: string, candidateConfidence: SportsLogoConfidence): Promise<SportsLogoResolution | null> {
  const apiKey = sportsDbApiKey();
  if (!apiKey) return null;

  const leagueMatch = await fetchTheSportsDbLeagueTeamLogo(teamName, category, rawContext, candidateConfidence);
  if (leagueMatch) return leagueMatch;

  const url = `${THE_SPORTS_DB_BASE_URL}/${encodeURIComponent(apiKey)}/searchteams.php?t=${encodeURIComponent(teamName)}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) return null;

  const data = (await response.json()) as { teams?: Array<Record<string, unknown>> | null };
  const teams = Array.isArray(data.teams) ? data.teams : [];
  const match = teams
    .map((team) => ({ team, confidence: teamRecordMatchConfidence(team, teamName, candidateConfidence) }))
    .find((item): item is { team: Record<string, unknown>; confidence: SportsLogoConfidence } => item.confidence !== null);
  if (!match) {
    logRejectedTeamMatches(teamName, teams, "search");
    return null;
  }

  const logoUrl = logoFromTeamRecord(match.team);
  const resolvedTeamName = typeof match.team.strTeam === "string" && match.team.strTeam.trim() ? match.team.strTeam.trim() : teamName;
  return logoUrl ? sportsLogoResolution({ logoUrl, teamName: resolvedTeamName, source: "thesportsdb", confidence: match.confidence }) : null;
}

export async function resolveSportsLogo(input: SportsLogoInput): Promise<SportsLogoResolution> {
  const candidate = normalizeTeamCandidate(input.outcomeName, input.marketTitle, input.category, input.sport);
  const teamName = candidate?.teamName ?? input.outcomeName.trim();
  const category = normalizeSportsLogoCategory(input.category, input.sport);
  const rawContext = `${input.category ?? ""} ${input.sport ?? ""} ${input.marketTitle ?? ""} ${input.outcomeName}`;
  if (!teamName || NON_TEAM_CATEGORIES.has(category)) {
    return sportsLogoResolution({ logoUrl: null, teamName: input.outcomeName.trim(), source: "fallback", confidence: "fallback" });
  }

  const providerIdCachePart = input.sportsMonksTeamId === undefined || input.sportsMonksTeamId === null ? "" : `:${input.sportsMonksTeamId}`;
  const cacheKey = `${category}:${compactText(teamName)}${providerIdCachePart}`;
  const cache = getCache();
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    if (cached.value) return cached.value;
    if (cached.promise) return cached.promise;
  }

  const promise = fetchSportsMonksTeamLogo(teamName, category, candidate?.confidence ?? "exact_normalized_match", input.sportsMonksTeamId)
    .catch(() => null)
    .then((sportsMonks) => sportsMonks ?? fetchTheSportsDbTeamLogo(teamName, category, rawContext, candidate?.confidence ?? "exact_normalized_match"))
    .catch(() => null)
    .then((remote) => remote ?? sportsLogoResolution({ logoUrl: null, teamName, source: "fallback", confidence: "fallback" }));

  cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, promise });
  const value = await promise;
  cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  return value;
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
}
