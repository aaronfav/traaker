import { cleanOutcomeTeamCandidate, compactTeamText, stripTeamSuffix } from "@/lib/sports/marketTeamExtractor";

export type PolymarketTeamRecord = {
  id?: number | string;
  name?: string;
  displayName?: string;
  league?: string;
  record?: string;
  logo?: string | null;
  abbreviation?: string | null;
  alias?: string | null;
  aliases?: string[] | string | null;
  providerId?: number | string;
  color?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type PolymarketTeamMatch = {
  record: PolymarketTeamRecord;
  matchedBy: "id" | "provider_id" | "name" | "display_name" | "alias" | "abbreviation" | "normalized_alias";
  query: string;
  normalizedQuery: string;
};

type IndexedTeamEntry = {
  record: PolymarketTeamRecord;
  matchedBy: PolymarketTeamMatch["matchedBy"];
};

type PolymarketTeamsIndex = {
  records: PolymarketTeamRecord[];
  byId: Map<string, PolymarketTeamRecord>;
  byKey: Map<string, IndexedTeamEntry[]>;
};

type CacheEntry<T> = {
  expiresAt: number;
  value?: T;
  promise?: Promise<T>;
};

declare global {
  var __TRAAK_POLYMARKET_TEAMS_CACHE__: CacheEntry<PolymarketTeamsIndex> | undefined;
}

const GAMMA_TEAMS_URL = "https://gamma-api.polymarket.com/teams";
const TEAMS_PAGE_LIMIT = 100;
const TEAMS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const TEAMS_FALLBACK_TTL_MS = 10 * 60 * 1000;

function getTeamsCache() {
  if (!globalThis.__TRAAK_POLYMARKET_TEAMS_CACHE__) {
    globalThis.__TRAAK_POLYMARKET_TEAMS_CACHE__ = { expiresAt: 0 };
  }
  return globalThis.__TRAAK_POLYMARKET_TEAMS_CACHE__;
}

function cleanTeamText(value: string) {
  return compactTeamText(value).replace(/\s+/g, " ").trim();
}

const POLYMARKET_UPLOAD_HOST = "https://polymarket-upload.s3.us-east-2.amazonaws.com/";

function normalizePolymarketLogoUrl(value?: string | null) {
  const logo = value?.trim();
  if (!logo) return null;
  if (!logo.includes(POLYMARKET_UPLOAD_HOST)) return logo;
  const lastHostIndex = logo.lastIndexOf(POLYMARKET_UPLOAD_HOST);
  if (lastHostIndex <= 0) return logo;
  if (lastHostIndex === 0) return logo;
  return `${POLYMARKET_UPLOAD_HOST}${logo.slice(lastHostIndex + POLYMARKET_UPLOAD_HOST.length)}`;
}

function normalizePolymarketTeamRecord(team: PolymarketTeamRecord): PolymarketTeamRecord {
  return {
    ...team,
    logo: normalizePolymarketLogoUrl(team.logo ?? null),
  };
}

function publicUrl(url: URL) {
  const next = new URL(url.toString());
  return next.toString();
}

function teamDisplayName(team: PolymarketTeamRecord) {
  return team.displayName?.trim() || team.name?.trim() || "";
}

function aliasParts(value: unknown): string[] {
  if (!value) return [];
  const raw: string[] = Array.isArray(value) ? value.flatMap((item) => aliasParts(item)) : String(value).split(/[,|/;]+/g);
  return raw.map((item: string) => item.trim()).filter(Boolean);
}

function teamKeyVariants(team: PolymarketTeamRecord) {
  const displayName = teamDisplayName(team);
  const name = team.name?.trim() || "";
  const alias = team.alias?.trim() || "";
  const abbreviation = team.abbreviation?.trim() || "";
  const aliases = aliasParts(team.aliases);
  const values = [name, displayName, alias, abbreviation, ...aliases];
  const variants = new Set<string>();

  for (const value of values) {
    const normalized = cleanTeamText(value);
    if (!normalized) continue;
    variants.add(normalized);
    variants.add(cleanTeamText(stripTeamSuffix(value)));
    variants.add(cleanTeamText(cleanOutcomeTeamCandidate(value) || value));
  }

  if (name) {
    const stripped = cleanTeamText(stripTeamSuffix(name));
    if (stripped) variants.add(stripped);
  }

  return [...variants].filter(Boolean);
}

function indexTeam(index: PolymarketTeamsIndex, team: PolymarketTeamRecord) {
  if (team.id !== undefined && team.id !== null) {
    index.byId.set(String(team.id), team);
  }
  if (team.providerId !== undefined && team.providerId !== null) {
    index.byId.set(`provider:${String(team.providerId)}`, team);
  }

  const entries: Array<[string, IndexedTeamEntry["matchedBy"]]> = [
    [cleanTeamText(team.name ?? ""), "name"],
    [cleanTeamText(teamDisplayName(team)), "display_name"],
    [cleanTeamText(team.alias ?? ""), "alias"],
    [cleanTeamText(team.abbreviation ?? ""), "abbreviation"],
  ];

  for (const alias of aliasParts(team.aliases)) {
    entries.push([cleanTeamText(alias), "normalized_alias"]);
  }

  for (const [key, matchedBy] of entries) {
    if (!key) continue;
    const bucket = index.byKey.get(key) ?? [];
    bucket.push({ record: team, matchedBy });
    index.byKey.set(key, bucket);
  }

  for (const variant of teamKeyVariants(team)) {
    const bucket = index.byKey.get(variant) ?? [];
    bucket.push({ record: team, matchedBy: variant === cleanTeamText(team.abbreviation ?? "") ? "abbreviation" : "normalized_alias" });
    index.byKey.set(variant, bucket);
  }
}

function buildIndex(records: PolymarketTeamRecord[]): PolymarketTeamsIndex {
  const normalizedRecords = records.map((team) => normalizePolymarketTeamRecord(team));
  const index: PolymarketTeamsIndex = { records: normalizedRecords, byId: new Map(), byKey: new Map() };
  for (const team of normalizedRecords) indexTeam(index, team);
  return index;
}

async function fetchPolymarketTeamsPage(offset: number, limit = TEAMS_PAGE_LIMIT) {
  const url = new URL(GAMMA_TEAMS_URL);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  const response = await fetch(publicUrl(url), { cache: "no-store" });
  if (!response.ok) return [];
  const data = (await response.json()) as unknown;
  return Array.isArray(data) ? (data as PolymarketTeamRecord[]) : [];
}

async function fetchAllPolymarketTeams() {
  const cache = getTeamsCache();
  if (cache.value && cache.expiresAt > Date.now()) return cache.value;
  if (cache.promise) return cache.promise;

  const promise = (async () => {
    const records: PolymarketTeamRecord[] = [];
    let offset = 0;
    let page: PolymarketTeamRecord[] = [];

    do {
      page = await fetchPolymarketTeamsPage(offset);
      if (page.length) records.push(...page);
      offset += TEAMS_PAGE_LIMIT;
    } while (page.length === TEAMS_PAGE_LIMIT && offset < TEAMS_PAGE_LIMIT * 100);

    return buildIndex(records);
  })();

  cache.promise = promise;
  try {
    const value = await promise;
    cache.value = value;
    cache.expiresAt = Date.now() + TEAMS_CACHE_TTL_MS;
    cache.promise = undefined;
    return value;
  } catch (error) {
    cache.expiresAt = Date.now() + TEAMS_FALLBACK_TTL_MS;
    cache.promise = undefined;
    throw error;
  }
}

function teamMatchPriority(matchedBy: PolymarketTeamMatch["matchedBy"]) {
  switch (matchedBy) {
    case "id":
      return 0;
    case "provider_id":
      return 1;
    case "name":
      return 2;
    case "display_name":
      return 3;
    case "alias":
      return 4;
    case "abbreviation":
      return 5;
    case "normalized_alias":
      return 6;
    default:
      return 9;
  }
}

function chooseBestMatch(matches: PolymarketTeamMatch[]) {
  return [...matches].sort((a, b) => teamMatchPriority(a.matchedBy) - teamMatchPriority(b.matchedBy) || a.record.name?.localeCompare(b.record.name ?? "") || 0)[0] ?? null;
}

export function cleanPolymarketTeamQuery(value: string) {
  return cleanTeamText(cleanOutcomeTeamCandidate(value) || value);
}

export async function getPolymarketTeamsIndex() {
  return fetchAllPolymarketTeams();
}

export async function matchPolymarketTeam(query: string) {
  const normalizedQuery = cleanPolymarketTeamQuery(query);
  if (!normalizedQuery) return null;

  const index = await fetchAllPolymarketTeams();
  const idKeys = [String(query).trim(), normalizedQuery]
    .map((value) => value.trim())
    .filter((value) => /^\d+$/.test(value));

  for (const key of idKeys) {
    const byId = index.byId.get(key) ?? index.byId.get(`provider:${key}`);
    if (byId) {
      return {
        record: byId,
        matchedBy: index.byId.has(key) ? ("id" as const) : ("provider_id" as const),
        query,
        normalizedQuery,
      };
    }
  }

  const lookupKeys = [normalizedQuery, cleanTeamText(stripTeamSuffix(normalizedQuery)), cleanTeamText(query)];
  const matches = lookupKeys.flatMap((key) => {
    const entries = index.byKey.get(key) ?? [];
    return entries.map((entry) => ({
      record: entry.record,
      matchedBy: entry.matchedBy,
      query,
      normalizedQuery,
    }));
  });

  const best = chooseBestMatch(matches);
  return best ?? null;
}

export async function matchPolymarketTeams(queries: string[]) {
  const index = await fetchAllPolymarketTeams();
  const results: Array<PolymarketTeamMatch | null> = [];
  for (const query of queries) {
    const normalizedQuery = cleanPolymarketTeamQuery(query);
    if (!normalizedQuery) {
      results.push(null);
      continue;
    }
    const direct = await matchPolymarketTeam(query);
    results.push(direct);
  }
  return { index, results };
}

export async function resolvePolymarketTeamLogo(query: string) {
  const match = await matchPolymarketTeam(query);
  const logoUrl = normalizePolymarketLogoUrl(match?.record.logo ?? null);
  return {
    match,
    logoUrl,
  };
}

export function resetPolymarketTeamsCache() {
  globalThis.__TRAAK_POLYMARKET_TEAMS_CACHE__ = { expiresAt: 0 };
}
