import { findTeamStyleMatch } from "@/lib/sports/teamStyles";

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

type CacheEntry = {
  expiresAt: number;
  value?: SportsLogoResolution;
  promise?: Promise<SportsLogoResolution>;
};

type LogoCacheStore = Map<string, CacheEntry>;

declare global {
  var __TRAAK_SPORTS_LOGO_CACHE__: LogoCacheStore | undefined;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const THE_SPORTS_DB_BASE_URL = "https://www.thesportsdb.com/api/v1/json";

const TEAM_ALIASES: Record<string, string> = {
  "76ers": "Philadelphia 76ers",
  "49ers": "San Francisco 49ers",
  arsenal: "Arsenal",
  barca: "Barcelona",
  barcelona: "Barcelona",
  bucks: "Milwaukee Bucks",
  bulls: "Chicago Bulls",
  cavaliers: "Cleveland Cavaliers",
  cavs: "Cleveland Cavaliers",
  celtics: "Boston Celtics",
  chelsea: "Chelsea",
  chiefs: "Kansas City Chiefs",
  clippers: "Los Angeles Clippers",
  cowboys: "Dallas Cowboys",
  dodgers: "Los Angeles Dodgers",
  eagles: "Philadelphia Eagles",
  heat: "Miami Heat",
  knicks: "New York Knicks",
  lakers: "Los Angeles Lakers",
  liverpool: "Liverpool",
  "man city": "Manchester City",
  "man utd": "Manchester United",
  "man united": "Manchester United",
  mavericks: "Dallas Mavericks",
  nets: "Brooklyn Nets",
  nuggets: "Denver Nuggets",
  "ny knicks": "New York Knicks",
  pacers: "Indiana Pacers",
  packers: "Green Bay Packers",
  psg: "Paris Saint-Germain",
  raptors: "Toronto Raptors",
  "real madrid": "Real Madrid",
  sixers: "Philadelphia 76ers",
  suns: "Phoenix Suns",
  thunder: "Oklahoma City Thunder",
  warriors: "Golden State Warriors",
  yankees: "New York Yankees",
};

const NON_TEAM_CATEGORIES = new Set(["UFC", "Tennis", "Market"]);

function getCache() {
  if (!globalThis.__TRAAK_SPORTS_LOGO_CACHE__) {
    globalThis.__TRAAK_SPORTS_LOGO_CACHE__ = new Map();
  }
  return globalThis.__TRAAK_SPORTS_LOGO_CACHE__;
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
  return name === target || alternates.includes(target);
}

function leagueNameForCategory(category: string) {
  if (category === "NBA") return "NBA";
  if (category === "NFL") return "NFL";
  return null;
}

async function fetchTheSportsDbLeagueTeamLogo(teamName: string, category: string): Promise<SportsLogoResolution | null> {
  const apiKey = sportsDbApiKey();
  const leagueName = leagueNameForCategory(category);
  if (!apiKey || !leagueName) return null;

  const url = `${THE_SPORTS_DB_BASE_URL}/${encodeURIComponent(apiKey)}/search_all_teams.php?l=${encodeURIComponent(leagueName)}`;
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

async function fetchTheSportsDbTeamLogo(teamName: string, category: string): Promise<SportsLogoResolution | null> {
  const apiKey = sportsDbApiKey();
  if (!apiKey) return null;

  const url = `${THE_SPORTS_DB_BASE_URL}/${encodeURIComponent(apiKey)}/searchteams.php?t=${encodeURIComponent(teamName)}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) return null;

  const data = (await response.json()) as { teams?: Array<Record<string, unknown>> | null };
  const teams = Array.isArray(data.teams) ? data.teams : [];
  const team = teams.find((item) => teamRecordMatches(item, teamName));
  if (!team) return fetchTheSportsDbLeagueTeamLogo(teamName, category);

  const logoUrl = logoFromTeamRecord(team);
  const resolvedTeamName = typeof team.strTeam === "string" && team.strTeam.trim() ? team.strTeam.trim() : teamName;
  return logoUrl ? { logoUrl, teamName: resolvedTeamName, source: "thesportsdb" } : fetchTheSportsDbLeagueTeamLogo(teamName, category);
}

export async function resolveSportsLogo(input: SportsLogoInput): Promise<SportsLogoResolution> {
  const teamName = normalizeTeamName(input.outcomeName, input.marketTitle, input.category, input.sport) ?? input.outcomeName.trim();
  const category = normalizeSportsLogoCategory(input.category, input.sport);
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

  const promise = fetchTheSportsDbTeamLogo(teamName, category)
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
}
