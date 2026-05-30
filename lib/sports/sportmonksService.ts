import { memoizeAsync } from "./enrichmentCache";
import type { ResolvedEntityCandidate } from "./sportsResolverService";

type SportmonksResponse<T> = { data?: T[] | T; meta?: Record<string, unknown> };

type SportmonksTeam = {
  id?: number;
  name?: string;
  image_path?: string | null;
  logo_path?: string | null;
  logo?: string | null;
  image?: string | null;
  short_code?: string | null;
  country_id?: number | null;
  league_id?: number | null;
  venue_id?: number | null;
};

type SportmonksFixtureParticipant = {
  id?: number;
  name?: string;
  short_code?: string | null;
  image_path?: string | null;
  logo_path?: string | null;
  meta?: {
    location?: string;
  };
};

type SportmonksFixture = {
  id?: number;
  league_id?: number;
  venue_id?: number | null;
  state_id?: number;
  name?: string;
  starting_at?: string;
  result_info?: string | null;
  has_odds?: boolean;
  has_premium_odds?: boolean;
  participants?: SportmonksFixtureParticipant[];
  scores?: Array<{
    description?: string;
    score?: {
      participant?: string;
      goals?: number;
    }[];
  }>;
  venue?: {
    name?: string;
  };
  state?: {
    state?: string;
  };
};

type SportmonksStanding = {
  participant_id?: number;
  position?: number;
  points?: number;
  result?: string;
  participant?: {
    name?: string;
  };
};

type SportmonksOdd = {
  fixture_id?: number;
  market_id?: number;
  bookmaker_id?: number;
  label?: string;
  value?: string;
  name?: string;
  market_description?: string;
  probability?: string;
  participants?: string | null;
};

const BASE_URL = "https://api.sportmonks.com/v3/football";
const ODD_TTL_MS = 90_000;
const LIVE_TTL_MS = 30_000;
const STATIC_TTL_MS = 24 * 60 * 60 * 1000;
const SCHEDULE_TTL_MS = 16 * 60 * 60 * 1000;

function apiToken() {
  return process.env.SPORTMONKS_API_KEY?.trim() || "";
}

function hasToken() {
  return Boolean(apiToken());
}

function url(path: string) {
  const next = new URL(`${BASE_URL}${path}`);
  next.searchParams.set("api_token", apiToken());
  return next.toString();
}

async function fetchJson<T>(path: string, ttlMs: number) {
  if (!hasToken()) return null;
  const requestUrl = url(path);
  return memoizeAsync<T | null>(`sportmonks:${requestUrl}`, ttlMs, async () => {
    const response = await fetch(requestUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`Sportmonks request failed with ${response.status}`);
    return (await response.json()) as T;
  });
}

function normalizeTeam(team: SportmonksTeam): ResolvedEntityCandidate {
  return {
    id: team.id,
    name: team.name ?? "",
    logo: team.logo_path ?? team.image_path ?? team.logo ?? team.image ?? undefined,
    sport: "Soccer",
    league: team.league_id ? String(team.league_id) : undefined,
  };
}

function normalizeFixture(fixture: SportmonksFixture): ResolvedEntityCandidate {
  const participants = fixture.participants ?? [];
  const home = participants[0]?.name ?? "";
  const away = participants[1]?.name ?? "";
  return {
    id: fixture.id,
    name: fixture.name ?? [home, away].filter(Boolean).join(" vs "),
    startTime: fixture.starting_at,
    venue: fixture.venue?.name,
    league: fixture.league_id ? String(fixture.league_id) : undefined,
    scoreText: fixture.result_info ?? undefined,
  };
}

export async function searchTeams(query: string) {
  if (!query.trim() || !hasToken()) return [] as ResolvedEntityCandidate[];
  const payload = await fetchJson<SportmonksResponse<SportmonksTeam>>(`/teams/search/${encodeURIComponent(query)}`, STATIC_TTL_MS);
  const teams = Array.isArray(payload?.data) ? payload.data : [];
  return teams.map(normalizeTeam);
}

export async function searchFixtures(query: string) {
  if (!query.trim() || !hasToken()) return [] as ResolvedEntityCandidate[];
  const payload = await fetchJson<SportmonksResponse<SportmonksFixture>>(`/fixtures/search/${encodeURIComponent(query)}`, SCHEDULE_TTL_MS);
  const fixtures = Array.isArray(payload?.data) ? payload.data : [];
  return fixtures.map(normalizeFixture);
}

export async function lookupFixture(fixtureId: string) {
  if (!fixtureId.trim() || !hasToken()) return null;
  const payload = await fetchJson<SportmonksResponse<SportmonksFixture>>(`/fixtures/${encodeURIComponent(fixtureId)}?include=participants;venue;state;scores`, SCHEDULE_TTL_MS);
  const fixture = Array.isArray(payload?.data) ? payload.data[0] : payload?.data;
  return fixture ? normalizeFixture(fixture) : null;
}

export async function fetchLiveStandings(leagueId: string) {
  if (!leagueId.trim() || !hasToken()) return [];
  const payload = await fetchJson<SportmonksResponse<SportmonksStanding>>(`/standings/live/leagues/${encodeURIComponent(leagueId)}`, LIVE_TTL_MS);
  const standings = Array.isArray(payload?.data) ? payload.data : [];
  return standings.map((standing) => ({
    teamName: standing.participant?.name ?? "",
    position: standing.position ?? 0,
    points: standing.points ?? 0,
    result: standing.result ?? "",
  }));
}

export async function fetchFixtureOdds(fixtureId: string) {
  if (!fixtureId.trim() || !hasToken()) return [];
  const payload = await fetchJson<SportmonksResponse<SportmonksOdd>>(`/odds/pre-match/fixtures/${encodeURIComponent(fixtureId)}`, ODD_TTL_MS);
  return Array.isArray(payload?.data) ? payload.data : [];
}
