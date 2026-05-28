import { cleanOutcomeTeamCandidate, compactTeamText, extractMarketTeams, stripTeamSuffix } from "@/lib/sports/marketTeamExtractor";

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

export type PolymarketTeamLookupAttempt = {
  source: "teams" | "team_page";
  query: string;
  normalizedQuery: string;
  candidates: string[];
  matchedTeam: string | null;
  logoUrl: string | null;
  rejectedReason?: string;
  teamPageUrl?: string;
};

export type PolymarketTeamLookupDebug = {
  attempts: PolymarketTeamLookupAttempt[];
  chosenCandidate: PolymarketTeamLookupAttempt | null;
};

export type PolymarketTeamLookupContext = {
  category?: string;
  sport?: string;
  marketTitle?: string;
};

export type PolymarketTeamLookupOptions = {
  includeTeamPageLookup?: boolean;
  teamPageTimeoutMs?: number;
  teamsTimeoutMs?: number;
};

export type PolymarketTeamLogoResolution = {
  match: PolymarketTeamMatch | null;
  logoUrl: string | null;
  source: "teams" | "team_page" | null;
  debug: PolymarketTeamLookupDebug;
  acceptedReason?: string;
  rejectionReason?: string;
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
  var __TRAAK_POLYMARKET_TEAM_PAGE_CACHE__: Map<string, CacheEntry<PolymarketTeamLogoResolution | null>> | undefined;
}

const GAMMA_TEAMS_URL = "https://gamma-api.polymarket.com/teams";
const POLYMARKET_TEAMS_BASE_URL = "https://polymarket.com/teams";
const TEAMS_PAGE_LIMIT = 100;
const TEAMS_FETCH_TIMEOUT_MS = 12_000;
const TEAM_PAGE_FETCH_TIMEOUT_MS = 700;
const TEAMS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const TEAMS_FALLBACK_TTL_MS = 10 * 60 * 1000;
const TEAM_PAGE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const TEAM_PAGE_FALLBACK_TTL_MS = 10 * 60 * 1000;

function getTeamsCache() {
  if (!globalThis.__TRAAK_POLYMARKET_TEAMS_CACHE__) {
    globalThis.__TRAAK_POLYMARKET_TEAMS_CACHE__ = { expiresAt: 0 };
  }
  return globalThis.__TRAAK_POLYMARKET_TEAMS_CACHE__;
}

function getTeamPageCache() {
  if (!globalThis.__TRAAK_POLYMARKET_TEAM_PAGE_CACHE__) {
    globalThis.__TRAAK_POLYMARKET_TEAM_PAGE_CACHE__ = new Map();
  }
  return globalThis.__TRAAK_POLYMARKET_TEAM_PAGE_CACHE__;
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

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function getContextText(context?: PolymarketTeamLookupContext) {
  return cleanTeamText(`${context?.category ?? ""} ${context?.sport ?? ""} ${context?.marketTitle ?? ""}`);
}

function inferPolymarketTeamPageGames(context?: PolymarketTeamLookupContext) {
  const normalized = getContextText(context);
  if (/\bmlb|baseball\b/.test(normalized)) return ["mlb"];
  if (/\btennis\b/.test(normalized)) return ["atp", "wta"];
  if (/\bufc|mma|boxing\b/.test(normalized)) return ["ufc"];
  if (/\bformula 1|f1\b/.test(normalized)) return ["f1"];
  if (/\bbasketball|nba\b/.test(normalized)) return ["nba"];
  return [];
}

function slugifyTeamName(value: string) {
  return cleanTeamText(value).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function normalizeJsonLdText(value: unknown) {
  return cleanTeamText(String(value ?? ""));
}

function teamPageCacheKey(game: string, query: string) {
  return `slow:${game}:${cleanTeamText(query)}`;
}

function parsePolymarketTeamPageLogo(html: string, teamName: string) {
  const scripts = [...html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
  const normalizedQuery = cleanTeamText(teamName);
  const strippedQuery = cleanTeamText(stripTeamSuffix(teamName));

  for (const script of scripts) {
    const raw = script[1]?.trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as unknown;
      const records = Array.isArray(parsed) ? parsed : [parsed];
      for (const record of records) {
        if (!record || typeof record !== "object") continue;
        const data = record as Record<string, unknown>;
        if (data["@type"] !== "SportsTeam") continue;
        const name = normalizeJsonLdText(data.name);
        const alt = normalizeJsonLdText(data.alternateName);
        const logo = typeof data.logo === "string" ? normalizePolymarketLogoUrl(data.logo) : null;
        if (!logo) continue;
        if (name === normalizedQuery || name === strippedQuery || alt === normalizedQuery || alt === strippedQuery) {
          return {
            name: typeof data.name === "string" ? data.name.trim() : teamName,
            displayName: typeof data.name === "string" ? data.name.trim() : teamName,
            abbreviation: typeof data.alternateName === "string" ? data.alternateName.trim() : null,
            logo,
          };
        }
      }
    } catch {
      continue;
    }
  }

  return null;
}

async function fetchPolymarketTeamPageResolution(
  query: string,
  context?: PolymarketTeamLookupContext,
  options?: PolymarketTeamLookupOptions,
): Promise<PolymarketTeamLogoResolution | null> {
  const games = inferPolymarketTeamPageGames(context);
  if (process.env.LOGO_DEBUG === "true") {
    console.log("[Traak] polymarket team page games", {
      query,
      context,
      games,
    });
  }
  if (!games.length) return null;
  const timeoutMs = Math.max(250, Math.min(1500, options?.teamPageTimeoutMs ?? TEAM_PAGE_FETCH_TIMEOUT_MS));

  const cache = getTeamPageCache();

  const extractedTeams = extractMarketTeams({
    marketTitle: context?.marketTitle,
    category: context?.category,
    sport: context?.sport,
    outcomes: [query],
  });
  const slugCandidates = [...new Set([query, cleanPolymarketTeamQuery(query), stripTeamSuffix(query), extractedTeams.outcomeTeamMap[query], ...extractedTeams.canonicalTeams]).values()]
    .filter((value): value is string => Boolean(value))
    .map((value) => cleanTeamText(value))
    .filter(Boolean)
    .map(slugifyTeamName)
    .filter(Boolean);
  const pageCandidates = slugCandidates.length ? slugCandidates : [slugifyTeamName(query)];
  const attempts: PolymarketTeamLookupAttempt[] = [];
  const cacheKey = teamPageCacheKey(games.join("|"), query);

  const promise = (async () => {
    for (const game of games) {
      const cacheKey = teamPageCacheKey(game, query);
      const cached = cache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        if (cached.value) return cached.value;
        if (cached.promise) return cached.promise;
      }

      const gamePromise = (async () => {
        for (const slug of pageCandidates) {
          const teamPageUrl = `${POLYMARKET_TEAMS_BASE_URL}/${game}/${slug}`;
          const response = await fetchWithTimeout(teamPageUrl, { cache: "no-store" }, timeoutMs);
          if (!response.ok) {
            attempts.push({
              source: "team_page",
              query,
              normalizedQuery: cleanTeamText(query),
              candidates: [slug],
              matchedTeam: null,
              logoUrl: null,
              rejectedReason: `team page returned status ${response.status}`,
              teamPageUrl,
            });
            continue;
          }

          const html = await response.text();
          const parsed = parsePolymarketTeamPageLogo(html, query) ?? parsePolymarketTeamPageLogo(html, cleanPolymarketTeamQuery(query));
          if (!parsed) {
            attempts.push({
              source: "team_page",
              query,
              normalizedQuery: cleanTeamText(query),
              candidates: [slug],
              matchedTeam: null,
              logoUrl: null,
              rejectedReason: "team page logo did not match requested team",
              teamPageUrl,
            });
            continue;
          }

          const result: PolymarketTeamLogoResolution = {
            match: {
              record: {
                name: parsed.name,
                displayName: parsed.displayName,
                abbreviation: parsed.abbreviation,
                logo: parsed.logo,
                league: game.toUpperCase(),
              },
              matchedBy: "name",
              query,
              normalizedQuery: cleanTeamText(query),
            },
            logoUrl: parsed.logo,
            source: "team_page",
            acceptedReason: "polymarket-team-page",
            debug: {
              attempts: [
                ...attempts,
                {
                  source: "team_page",
                  query,
                  normalizedQuery: cleanTeamText(query),
                  candidates: [slug],
                  matchedTeam: parsed.name,
                  logoUrl: parsed.logo,
                  teamPageUrl,
                },
              ],
              chosenCandidate: {
                source: "team_page",
                query,
                normalizedQuery: cleanTeamText(query),
                candidates: [slug],
                matchedTeam: parsed.name,
                logoUrl: parsed.logo,
                teamPageUrl,
              },
            },
          };
          return result;
        }

        return null;
      })();

      cache.set(cacheKey, { expiresAt: Date.now() + TEAM_PAGE_CACHE_TTL_MS, promise: gamePromise });
      const result = await gamePromise;
      if (result) return result;
    }

    const result: PolymarketTeamLogoResolution = {
      match: null,
      logoUrl: null,
      source: null,
      rejectionReason: "no exact /teams index match or team page logo match",
      debug: {
        attempts,
        chosenCandidate: null,
      },
    };
    return result;
  })();

  cache.set(cacheKey, { expiresAt: Date.now() + TEAM_PAGE_CACHE_TTL_MS, promise });
  try {
    const value = await promise;
    cache.set(cacheKey, { expiresAt: Date.now() + (value?.logoUrl ? TEAM_PAGE_CACHE_TTL_MS : TEAM_PAGE_FALLBACK_TTL_MS), value: value ?? undefined });
    return value;
  } catch {
    cache.set(cacheKey, { expiresAt: Date.now() + TEAM_PAGE_FALLBACK_TTL_MS });
    return null;
  }
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
  const response = await fetchWithTimeout(publicUrl(url), { cache: "no-store" }, TEAMS_FETCH_TIMEOUT_MS);
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

function matchPolymarketTeamInIndex(index: PolymarketTeamsIndex, query: string) {
  const normalizedQuery = cleanPolymarketTeamQuery(query);
  if (!normalizedQuery) return null;

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

export async function matchPolymarketTeam(query: string) {
  const index = await fetchAllPolymarketTeams();
  return matchPolymarketTeamInIndex(index, query);
}

export function peekPolymarketTeamLogo(
  query: string,
  context?: PolymarketTeamLookupContext,
  options?: Pick<PolymarketTeamLookupOptions, "includeTeamPageLookup">,
): PolymarketTeamLogoResolution | null {
  const normalizedQuery = cleanPolymarketTeamQuery(query);
  if (!normalizedQuery) return null;

  const indexCache = getTeamsCache();
  const index = indexCache.value && indexCache.expiresAt > Date.now() ? indexCache.value : null;

  if (index) {
    const directMatch = matchPolymarketTeamInIndex(index, query);
    const directResolution = directMatch ? buildDirectMatchResolution(query, directMatch) : null;
    if (directResolution) {
      return directResolution;
    }
  }

  if (options?.includeTeamPageLookup) {
    const cache = getTeamPageCache();
    const games = inferPolymarketTeamPageGames(context);
    for (const game of games) {
      const cacheKey = teamPageCacheKey(game, query);
      const cached = cache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now() && cached.value?.logoUrl && cached.value.match) {
        return cached.value;
      }
    }
  }

  return null;
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

function buildDirectMatchResolution(query: string, directMatch: PolymarketTeamMatch): PolymarketTeamLogoResolution | null {
  const logoUrl = normalizePolymarketLogoUrl(directMatch.record.logo ?? null);
  if (!logoUrl) return null;
  return {
    match: directMatch,
    logoUrl,
    source: "teams",
    acceptedReason: "polymarket-team",
    debug: {
      attempts: [
        {
          source: "teams",
          query,
          normalizedQuery: directMatch.normalizedQuery,
          candidates: [directMatch.record.name ?? directMatch.record.displayName ?? query],
          matchedTeam: directMatch.record.name ?? directMatch.record.displayName ?? null,
          logoUrl,
          rejectedReason: logoUrl ? undefined : "matched team record has no logo",
        },
      ],
      chosenCandidate: {
        source: "teams",
        query,
        normalizedQuery: directMatch.normalizedQuery,
        candidates: [directMatch.record.name ?? directMatch.record.displayName ?? query],
        matchedTeam: directMatch.record.name ?? directMatch.record.displayName ?? null,
        logoUrl,
      },
    },
  };
}

export async function resolvePolymarketTeamLogo(
  query: string,
  context?: PolymarketTeamLookupContext,
  options?: PolymarketTeamLookupOptions,
): Promise<PolymarketTeamLogoResolution> {
  const normalizedQuery = cleanPolymarketTeamQuery(query);
  const index = await fetchAllPolymarketTeams().catch(() => null);
  const attempts: PolymarketTeamLookupAttempt[] = [];
  attempts.push({
    source: "teams",
    query,
    normalizedQuery,
    candidates: (index?.records ?? [])
      .filter((team) => {
        const name = cleanTeamText(team.name ?? "");
        const display = cleanTeamText(teamDisplayName(team));
        const alias = cleanTeamText(team.alias ?? "");
        const abbreviation = cleanTeamText(team.abbreviation ?? "");
        return [name, display, alias, abbreviation].some(Boolean);
      })
      .slice(0, 8)
      .map((team) => team.name ?? team.displayName ?? team.abbreviation ?? ""),
    matchedTeam: null,
    logoUrl: null,
    rejectedReason: "no exact /teams index match",
  });

  const directMatch = index ? matchPolymarketTeamInIndex(index, query) : null;
  const directResolution = directMatch ? buildDirectMatchResolution(query, directMatch) : null;
  if (directResolution) {
    return {
      ...directResolution,
      debug: {
        attempts: [...attempts, ...directResolution.debug.attempts],
        chosenCandidate: directResolution.debug.chosenCandidate,
      },
    };
  }

  if (options?.includeTeamPageLookup) {
    const teamPageResolution = await fetchPolymarketTeamPageResolution(query, context, options);
    if (teamPageResolution?.logoUrl && teamPageResolution.match) {
      return {
        ...teamPageResolution,
        debug: {
          attempts: [...attempts, ...teamPageResolution.debug.attempts],
          chosenCandidate: teamPageResolution.debug.chosenCandidate,
        },
      };
    }
    if (teamPageResolution) {
      return {
        ...teamPageResolution,
        debug: {
          attempts: [...attempts, ...teamPageResolution.debug.attempts],
          chosenCandidate: teamPageResolution.debug.chosenCandidate,
        },
      };
    }
  }

  return {
    match: null,
    logoUrl: null,
    source: null,
    rejectionReason: "no exact /teams index match or team page logo match",
    debug: {
      attempts,
      chosenCandidate: null,
    },
  };
}

export async function warmPolymarketTeamLogo(query: string, context?: PolymarketTeamLookupContext, options?: PolymarketTeamLookupOptions) {
  const resolvedOptions: PolymarketTeamLookupOptions = {
    ...options,
    includeTeamPageLookup: true,
  };
  void resolvePolymarketTeamLogo(query, context, resolvedOptions).catch(() => undefined);
}

export function resetPolymarketTeamsCache() {
  globalThis.__TRAAK_POLYMARKET_TEAMS_CACHE__ = { expiresAt: 0 };
  globalThis.__TRAAK_POLYMARKET_TEAM_PAGE_CACHE__ = new Map();
}
