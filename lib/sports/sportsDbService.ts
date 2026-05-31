import { memoizeAsync } from "./enrichmentCache";
import type { ResolvedEntityCandidate } from "./sportsResolverService";
import { logInfo } from "@/lib/server/logger";

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
  const endpoint = `searchteams.php?t=${encodeURIComponent(query)}`;
  logInfo("sportsdb.request", "TheSportsDB searchTeams request", { endpoint, query });
  const payload = await fetchJson<TheSportsDbResponse<TheSportsDbTeam>>(endpoint, 24 * 60 * 60 * 1000);
  const teams = (payload.teams ?? []).map(normalizeTeam);
  logInfo("sportsdb.response", "TheSportsDB searchTeams response", { endpoint, query, count: teams.length, chosen: teams[0]?.name ?? null });
  return teams;
}

export async function searchPlayers(query: string) {
  if (!query.trim()) return [] as ResolvedEntityCandidate[];
  const endpoint = `searchplayers.php?p=${encodeURIComponent(query)}`;
  logInfo("sportsdb.request", "TheSportsDB searchPlayers request", { endpoint, query });
  const payload = await fetchJson<TheSportsDbResponse<TheSportsDbPlayer>>(endpoint, 24 * 60 * 60 * 1000);
  const players = (payload.players ?? []).map(normalizePlayer);
  logInfo("sportsdb.response", "TheSportsDB searchPlayers response", { endpoint, query, count: players.length, chosen: players[0]?.name ?? null });
  return players;
}

export async function lookupTeam(teamId: string) {
  if (!teamId.trim()) return null;
  const endpoint = `lookupteam.php?id=${encodeURIComponent(teamId)}`;
  logInfo("sportsdb.request", "TheSportsDB lookupTeam request", { endpoint, teamId });
  const payload = await fetchJson<TheSportsDbResponse<TheSportsDbTeam>>(endpoint, 24 * 60 * 60 * 1000);
  const team = payload.teams?.[0];
  logInfo("sportsdb.response", "TheSportsDB lookupTeam response", { endpoint, teamId, found: Boolean(team), chosen: team?.strTeam ?? null });
  return team ? normalizeTeam(team) : null;
}

export async function lookupEvent(eventId: string) {
  if (!eventId.trim()) return null;
  const endpoint = `lookupevent.php?id=${encodeURIComponent(eventId)}`;
  logInfo("sportsdb.request", "TheSportsDB lookupEvent request", { endpoint, eventId });
  const payload = await fetchJson<TheSportsDbResponse<TheSportsDbEvent>>(endpoint, 24 * 60 * 60 * 1000);
  const event = payload.events?.[0] ?? (payload.event as TheSportsDbEvent | undefined);
  logInfo("sportsdb.response", "TheSportsDB lookupEvent response", { endpoint, eventId, found: Boolean(event), chosen: event?.strEvent ?? null });
  return event ? normalizeEvent(event) : null;
}

export async function getTeamRecentGames(teamId: string) {
  if (!teamId.trim()) return [];
  logInfo("sportsdb.request", "TheSportsDB recent games request", { teamId, endpoints: ["eventsnext.php", "eventslast.php"] });
  const [nextPayload, lastPayload] = await Promise.allSettled([
    fetchJson<TheSportsDbResponse<TheSportsDbEvent>>(`eventsnext.php?id=${encodeURIComponent(teamId)}`, 16 * 60 * 60 * 1000),
    fetchJson<TheSportsDbResponse<TheSportsDbEvent>>(`eventslast.php?id=${encodeURIComponent(teamId)}`, 16 * 60 * 60 * 1000),
  ]);
  const events = [
    ...(nextPayload.status === "fulfilled" ? nextPayload.value.events ?? [] : []),
    ...(lastPayload.status === "fulfilled" ? lastPayload.value.events ?? [] : []),
  ];
  const normalized = events.slice(0, 8).map((event) => normalizeEvent(event).name).filter(Boolean);
  logInfo("sportsdb.response", "TheSportsDB recent games response", { teamId, count: normalized.length, samples: normalized.slice(0, 4) });
  return normalized;
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
  const endpoint = `eventslast.php?id=${encodeURIComponent(teamId)}`;
  logInfo("sportsdb.request", "TheSportsDB recent form request", { endpoint, teamId, teamName });
  const payload = await fetchJson<TheSportsDbResponse<TheSportsDbEvent>>(endpoint, 16 * 60 * 60 * 1000);
  const events = payload?.events ?? [];
  const form = events.slice(0, 5).map((event) => formSymbol(event, teamName)).filter(Boolean);
  logInfo("sportsdb.response", "TheSportsDB recent form response", { endpoint, teamId, teamName, count: form.length, form });
  return form;
}
