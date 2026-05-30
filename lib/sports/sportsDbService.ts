import { memoizeAsync } from "./enrichmentCache";
import type { ResolvedEntityCandidate } from "./sportsResolverService";

type TheSportsDbResponse<T> = {
  teams?: T[];
  players?: T[];
  event?: T;
  events?: T[];
  [key: string]: unknown;
};

type TheSportsDbTeam = {
  idTeam?: string;
  strTeam?: string;
  strTeamShort?: string;
  strLeague?: string;
  strSport?: string;
  strCountry?: string;
  strBadge?: string;
  strLogo?: string;
  intFormedYear?: string;
  strStadium?: string;
  strDescriptionEN?: string;
};

type TheSportsDbPlayer = {
  idPlayer?: string;
  strPlayer?: string;
  strTeam?: string;
  strSport?: string;
  strNationality?: string;
  dateBorn?: string;
  strCutout?: string;
  strThumb?: string;
  strPosition?: string;
};

type TheSportsDbEvent = {
  idEvent?: string;
  strEvent?: string;
  strLeague?: string;
  strSport?: string;
  strHomeTeam?: string;
  strAwayTeam?: string;
  strVenue?: string;
  strStatus?: string;
  dateEvent?: string;
  strTime?: string;
  intHomeScore?: string;
  intAwayScore?: string;
};

const BASE_URL = "https://www.thesportsdb.com/api/v1/json";

function apiKey() {
  return process.env.SPORTSDB_API_KEY?.trim() || process.env.THESPORTSDB_API_KEY?.trim() || "1";
}

async function fetchJson<T>(path: string, ttlMs: number) {
  const url = `${BASE_URL}/${encodeURIComponent(apiKey())}/${path}`;
  return memoizeAsync<T>(`thesportsdb:${url}`, ttlMs, async () => {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`TheSportsDB request failed with ${response.status}`);
    return (await response.json()) as T;
  });
}

function normalizeTeam(team: TheSportsDbTeam): ResolvedEntityCandidate {
  return {
    id: team.idTeam,
    name: team.strTeam ?? "",
    league: team.strLeague,
    sport: team.strSport,
    country: team.strCountry,
    logo: team.strBadge || team.strLogo,
    venue: team.strStadium,
  };
}

function normalizePlayer(player: TheSportsDbPlayer): ResolvedEntityCandidate {
  return {
    id: player.idPlayer,
    name: player.strPlayer ?? "",
    sport: player.strSport,
    country: player.strNationality,
    logo: player.strCutout || player.strThumb,
    record: player.strPosition,
  };
}

function normalizeEvent(event: TheSportsDbEvent): ResolvedEntityCandidate {
  return {
    id: event.idEvent,
    name: event.strEvent ?? "",
    league: event.strLeague,
    sport: event.strSport,
    venue: event.strVenue,
    startTime: event.dateEvent && event.strTime ? `${event.dateEvent}T${event.strTime}` : event.dateEvent,
    scoreText: event.intHomeScore && event.intAwayScore ? `${event.intHomeScore}-${event.intAwayScore}` : undefined,
  };
}

export async function searchTeams(query: string) {
  if (!query.trim()) return [] as ResolvedEntityCandidate[];
  const payload = await fetchJson<TheSportsDbResponse<TheSportsDbTeam>>(`searchteams.php?t=${encodeURIComponent(query)}`, 24 * 60 * 60 * 1000);
  return (payload.teams ?? []).map(normalizeTeam);
}

export async function searchPlayers(query: string) {
  if (!query.trim()) return [] as ResolvedEntityCandidate[];
  const payload = await fetchJson<TheSportsDbResponse<TheSportsDbPlayer>>(`searchplayers.php?p=${encodeURIComponent(query)}`, 24 * 60 * 60 * 1000);
  return (payload.players ?? []).map(normalizePlayer);
}

export async function lookupTeam(teamId: string) {
  if (!teamId.trim()) return null;
  const payload = await fetchJson<TheSportsDbResponse<TheSportsDbTeam>>(`lookupteam.php?id=${encodeURIComponent(teamId)}`, 24 * 60 * 60 * 1000);
  const team = payload.teams?.[0];
  return team ? normalizeTeam(team) : null;
}

export async function lookupEvent(eventId: string) {
  if (!eventId.trim()) return null;
  const payload = await fetchJson<TheSportsDbResponse<TheSportsDbEvent>>(`lookupevent.php?id=${encodeURIComponent(eventId)}`, 24 * 60 * 60 * 1000);
  const event = payload.events?.[0] ?? (payload.event as TheSportsDbEvent | undefined);
  return event ? normalizeEvent(event) : null;
}

export async function getTeamRecentGames(teamId: string) {
  if (!teamId.trim()) return [];
  const [nextPayload, lastPayload] = await Promise.allSettled([
    fetchJson<TheSportsDbResponse<TheSportsDbEvent>>(`eventsnext.php?id=${encodeURIComponent(teamId)}`, 16 * 60 * 60 * 1000),
    fetchJson<TheSportsDbResponse<TheSportsDbEvent>>(`eventslast.php?id=${encodeURIComponent(teamId)}`, 16 * 60 * 60 * 1000),
  ]);
  const events = [
    ...(nextPayload.status === "fulfilled" ? nextPayload.value.events ?? [] : []),
    ...(lastPayload.status === "fulfilled" ? lastPayload.value.events ?? [] : []),
  ];
  return events.slice(0, 8).map((event) => normalizeEvent(event).name).filter(Boolean);
}

function formSymbol(event: TheSportsDbEvent, teamName: string) {
  const homeScore = Number(event.intHomeScore);
  const awayScore = Number(event.intAwayScore);
  if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) return "•";
  const home = (event.strHomeTeam ?? "").toLowerCase() === teamName.toLowerCase();
  const away = (event.strAwayTeam ?? "").toLowerCase() === teamName.toLowerCase();
  if (!home && !away) return "•";
  if (homeScore === awayScore) return "D";
  const teamWon = home ? homeScore > awayScore : awayScore > homeScore;
  return teamWon ? "W" : "L";
}

export async function getTeamRecentForm(teamId: string, teamName: string) {
  if (!teamId.trim() || !teamName.trim()) return [];
  const payload = await fetchJson<TheSportsDbResponse<TheSportsDbEvent>>(`eventslast.php?id=${encodeURIComponent(teamId)}`, 16 * 60 * 60 * 1000);
  const events = payload?.events ?? [];
  return events.slice(0, 5).map((event) => formSymbol(event, teamName)).filter(Boolean);
}
