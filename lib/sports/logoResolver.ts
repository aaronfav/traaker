import { findTeamStyleMatch } from "@/lib/sports/teamStyles";
import { TEAM_ALIASES, TEAM_SUFFIX_PATTERN } from "@/lib/sports/teamAliases";

export type SportsLogoSource = "thesportsdb" | "local" | "fallback";

export type SportsLogoInput = {
  marketTitle?: string;
  outcomeName: string;
  sport?: string;
  category?: string;
};

export type SportsLogoResolution = {
  logoUrl: string | null;
  teamName: string;
  source: SportsLogoSource;
};

type CacheEntry<T = SportsLogoResolution> = {
  expiresAt: number;
  value?: T;
  promise?: Promise<T>;
};

type LogoCacheStore = Map<string, CacheEntry>;
type LeagueCacheStore = Map<string, CacheEntry<Array<Record<string, unknown>>>>;

declare global {
  var __TRAAK_SPORTS_LOGO_CACHE__: LogoCacheStore | undefined;
  var __TRAAK_SPORTS_LEAGUE_LOGO_CACHE__: LeagueCacheStore | undefined;
}

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const THE_SPORTS_DB_BASE_URL = "https://www.thesportsdb.com/api/v1/json";

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
  const normalizedCategory = normalizeSportsLogoCategory(category, sport);
  if (NON_TEAM_CATEGORIES.has(normalizedCategory)) return null;

  const cleaned = compactText(outcomeName)
    .replace(/\b(to win|winner|wins?|moneyline|spread|market|yes|no|draw|tie|other|field|champions?|championship|advance|qualify)\b/g, " ")
    .replace(TEAM_SUFFIX_PATTERN, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || /^(yes|no|draw|tie|market|winner|other|field)$/.test(cleaned)) return null;

  const directAlias = TEAM_ALIASES[cleaned];
  if (directAlias) return directAlias;

  const aliasKey = Object.keys(TEAM_ALIASES)
    .sort((a, b) => b.length - a.length)
    .find((alias) => new RegExp(`(^| )${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`).test(cleaned));
  if (aliasKey) return TEAM_ALIASES[aliasKey];

  const title = compactText(marketTitle);
  const titleAlias = Object.keys(TEAM_ALIASES)
    .sort((a, b) => b.length - a.length)
    .find((alias) => cleaned.includes(alias) || (title.includes(alias) && title.includes(cleaned)));
  if (titleAlias) return TEAM_ALIASES[titleAlias];

  return titleCase(cleaned);
}

function sportsDbApiKey() {
  return process.env.THESPORTSDB_API_KEY?.trim() || (process.env.NODE_ENV === "test" ? "" : "123");
}

function localLogoFallback(teamName: string): SportsLogoResolution | null {
  const style = findTeamStyleMatch(teamName);
  const logoUrl = style?.logoUrl ?? style?.logoPath;
  return logoUrl ? { logoUrl, teamName, source: "local" } : null;
}

function logoFromTeamRecord(team: Record<string, unknown>) {
  const badge = typeof team.strTeamBadge === "string" ? team.strTeamBadge : "";
  const logo = typeof team.strTeamLogo === "string" ? team.strTeamLogo : "";
  const currentBadge = typeof team.strBadge === "string" ? team.strBadge : "";
  const currentLogo = typeof team.strLogo === "string" ? team.strLogo : "";
  return badge || logo || currentBadge || currentLogo || null;
}

function teamRecordMatches(team: Record<string, unknown>, teamName: string) {
  const target = compactText(teamName);
  const name = compactText(String(team.strTeam ?? ""));
  const alternates = String(team.strTeamAlternate ?? team.strAlternate ?? "")
    .split(",")
    .map(compactText)
    .filter(Boolean);
  const normalizedAlternates = alternates.map((item) => item.replace(TEAM_SUFFIX_PATTERN, " ").replace(/\s+/g, " ").trim());
  const targetWithoutSuffix = target.replace(TEAM_SUFFIX_PATTERN, " ").replace(/\s+/g, " ").trim();
  return name === target || name === targetWithoutSuffix || normalizedAlternates.includes(target) || normalizedAlternates.includes(targetWithoutSuffix);
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

async function fetchTheSportsDbLeagueTeamLogo(teamName: string, category: string, rawContext: string): Promise<SportsLogoResolution | null> {
  const apiKey = sportsDbApiKey();
  const leagueNames = leagueNamesForContext(category, rawContext);
  if (!apiKey || leagueNames.length === 0) return null;

  const teamLists = await Promise.all(leagueNames.map((leagueName) => fetchLeagueTeams(apiKey, leagueName)));
  const teams = teamLists.flat();
  const team = teams.find((item) => teamRecordMatches(item, teamName));
  if (!team) return null;

  const logoUrl = logoFromTeamRecord(team);
  const resolvedTeamName = typeof team.strTeam === "string" && team.strTeam.trim() ? team.strTeam.trim() : teamName;
  return logoUrl ? { logoUrl, teamName: resolvedTeamName, source: "thesportsdb" } : null;
}

async function fetchTheSportsDbTeamLogo(teamName: string, category: string, rawContext: string): Promise<SportsLogoResolution | null> {
  const apiKey = sportsDbApiKey();
  if (!apiKey) return null;

  const leagueMatch = await fetchTheSportsDbLeagueTeamLogo(teamName, category, rawContext);
  if (leagueMatch) return leagueMatch;

  const url = `${THE_SPORTS_DB_BASE_URL}/${encodeURIComponent(apiKey)}/searchteams.php?t=${encodeURIComponent(teamName)}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) return null;

  const data = (await response.json()) as { teams?: Array<Record<string, unknown>> | null };
  const teams = Array.isArray(data.teams) ? data.teams : [];
  const team = teams.find((item) => teamRecordMatches(item, teamName));
  if (!team) return null;

  const logoUrl = logoFromTeamRecord(team);
  const resolvedTeamName = typeof team.strTeam === "string" && team.strTeam.trim() ? team.strTeam.trim() : teamName;
  return logoUrl ? { logoUrl, teamName: resolvedTeamName, source: "thesportsdb" } : null;
}

export async function resolveSportsLogo(input: SportsLogoInput): Promise<SportsLogoResolution> {
  const teamName = normalizeTeamName(input.outcomeName, input.marketTitle, input.category, input.sport) ?? input.outcomeName.trim();
  const category = normalizeSportsLogoCategory(input.category, input.sport);
  const rawContext = `${input.category ?? ""} ${input.sport ?? ""} ${input.marketTitle ?? ""} ${input.outcomeName}`;
  if (!teamName || NON_TEAM_CATEGORIES.has(category)) {
    return { logoUrl: null, teamName: input.outcomeName.trim(), source: "fallback" };
  }

  const cacheKey = `${category}:${compactText(teamName)}`;
  const cache = getCache();
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    if (cached.value) return cached.value;
    if (cached.promise) return cached.promise;
  }

  const promise = fetchTheSportsDbTeamLogo(teamName, category, rawContext)
    .catch(() => null)
    .then((remote) => remote ?? localLogoFallback(teamName) ?? { logoUrl: null, teamName, source: "fallback" as const });

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
