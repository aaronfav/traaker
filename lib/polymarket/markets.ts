import { PriceHistoryInterval, Side, type OrderBookSummary } from "@polymarket/clob-client-v2";
import { opportunityScore, volumeAcceleration } from "@/lib/analytics/scoring";
import { createPolymarketClient } from "./client";
import { hasSportsSignal } from "./marketFilters";
import { mockChart, mockMarkets, mockOrderbook, mockTrades } from "./mock";
import { resolveSportsLogo } from "@/lib/sports/logoResolver";
import type { MarketChartPoint, MarketStatus, NormalizedOrderbook, RecentTrade, TerminalMarket } from "./types";

const GAMMA_HOST = "https://gamma-api.polymarket.com";
const GAMMA_PAGE_LIMIT = 200;
const GAMMA_SPORTS_EVENTS_PAGE_LIMIT = 100;
const GAMMA_SPORTS_EVENTS_MAX_PAGES = 50;

const sportsTerms = [
  "nba",
  "nfl",
  "mlb",
  "nhl",
  "wnba",
  "ncaa",
  "ncaaf",
  "ncaab",
  "ufc",
  "mma",
  "soccer",
  "football",
  "basketball",
  "baseball",
  "hockey",
  "tennis",
  "golf",
  "boxing",
  "cricket",
  "formula 1",
  "formula-1",
  "f1",
  "racing",
  "champions league",
  "premier league",
  "world cup",
  "mls",
  "f1",
  "formula",
  "sports",
];

type GammaMarket = Record<string, unknown>;
type GammaEvent = Record<string, unknown> & { markets?: GammaMarket[] };
type ExclusionReason = "closed" | "inactive" | "missingClobTokenIds" | "noOrderbook" | "invalidPrices";

type MarketEligibility = {
  isSports: boolean;
  isOpenSports: boolean;
  excludedReason: ExclusionReason | null;
  outcomes: string[];
  prices: number[];
  tokenIds: string[];
  outcomeOptions: NormalizedMarketOutcome[];
};

type NormalizedMarketOutcome = {
  name: string;
  price: number;
  tokenId: string;
  marketId?: string;
  conditionId?: string;
  bestBid?: number;
  bestAsk?: number;
};

type MarketDiscoveryCounts = {
  eventPagesFetched: number;
  eventsFetched: number;
  rawMarkets: number;
  sportsMarkets: number;
  openSportsMarkets: number;
  tradableMarkets: number;
  tradableSportsMarkets: number;
  liveSportsMarkets: number;
  upcomingSportsMarkets: number;
  staleOrUnknownSportsMarkets: number;
  displayedMarkets: number;
  totalEligibleSportsMarkets: number;
  marketsWithMinVolume: number;
  liveWithMinVolume: number;
  upcomingWithMinVolume: number;
  staleExcluded: number;
  minVolume: number;
  excludedClosed: number;
  excludedInactive: number;
  excludedMissingClobTokenIds: number;
  excludedNoOrderbook: number;
  excludedInvalidPrices: number;
};

export type SportsMarketDiscovery = {
  markets: TerminalMarket[];
  counts: MarketDiscoveryCounts;
  source: "polymarket" | "mock";
  debugMarkets: TerminalMarket[];
};

export type MarketQuerySort = "opportunity" | "volume" | "liquidity" | "movement" | "spread";
export type MarketQueryStatus = "live" | "upcoming" | "all" | "stale";

export type MarketQueryParams = {
  sport?: string;
  status?: MarketQueryStatus;
  sort?: MarketQuerySort;
  limit?: number;
  offset?: number;
  search?: string;
  minVolume?: number;
  includeStale?: boolean;
};

export type MarketPage = {
  markets: TerminalMarket[];
  limit: number;
  offset: number;
  total: number;
  returned: number;
  hasMore: boolean;
};

export type MarketsApiPayload = MarketPage & {
  counts: MarketDiscoveryCounts;
  countsLoading?: boolean;
  source: SportsMarketDiscovery["source"];
};

export type MarketCountsApiResponse =
  | {
      loading: true;
    }
  | {
      loading: false;
      counts: MarketDiscoveryCounts;
      source: SportsMarketDiscovery["source"];
    };

export const DEFAULT_MARKET_PAGE_LIMIT = 100;
export const MAX_MARKET_PAGE_LIMIT = 500;
export const DEFAULT_MARKET_MIN_VOLUME = 2000;
const MARKET_SNAPSHOT_CACHE_MS = 300_000;

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

type MarketSnapshot = {
  discovery: SportsMarketDiscovery;
  refreshedAt: number;
  expiresAt: number;
};

type TraakMarketSnapshotStore = {
  snapshot: CacheEntry<MarketSnapshot> | null;
  refreshPromise: Promise<MarketSnapshot> | null;
  warmupStartedAt: number | null;
};

declare global {
  var __TRAAK_MARKET_SNAPSHOT__: TraakMarketSnapshotStore | undefined;
}

function getMarketSnapshotStore() {
  if (!globalThis.__TRAAK_MARKET_SNAPSHOT__) {
    globalThis.__TRAAK_MARKET_SNAPSHOT__ = { snapshot: null, refreshPromise: null, warmupStartedAt: null };
  }
  return globalThis.__TRAAK_MARKET_SNAPSHOT__;
}

function parseArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function asNumber(value: unknown, fallback = 0) {
  const numeric = typeof value === "string" ? Number(value.trim().replace(/,/g, "")) : typeof value === "number" ? value : NaN;
  return Number.isFinite(numeric) ? numeric : fallback;
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function pick(obj: Record<string, unknown>, keys: string[], fallback: unknown = undefined) {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  return fallback;
}

function parseStringArray(value: unknown): string[] {
  return parseArray(value)
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
}

function parseNumberArray(value: unknown): number[] {
  const parsed = parseArray(value).map((item) => (typeof item === "string" ? Number(item.trim().replace(/,/g, "")) : typeof item === "number" ? item : NaN));
  return parsed.every((item) => Number.isFinite(item)) ? parsed : [];
}

function tokenRecordAt(tokens: unknown[], index: number) {
  const token = tokens[index];
  return token && typeof token === "object" ? (token as Record<string, unknown>) : {};
}

function tokenOutcomeName(token: Record<string, unknown>) {
  return asString(pick(token, ["outcome", "name", "label", "o"], ""), "");
}

function tokenIdFromRecord(token: Record<string, unknown>) {
  return asString(pick(token, ["token_id", "tokenID", "asset_id", "assetId", "id", "t"], ""), "");
}

function tokenPrice(token: Record<string, unknown>) {
  return asNumber(pick(token, ["price", "lastPrice", "last_trade_price", "lastTradePrice"], Number.NaN), Number.NaN);
}

function fallbackOutcomeName(index: number) {
  return `Outcome ${index + 1}`;
}

function normalizeOutcomeText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isUnhelpfulOutcomeName(name: string, marketTitle: string, index: number) {
  const normalizedName = normalizeOutcomeText(name);
  if (!normalizedName) return true;
  if (/^(yes|no|winner|champion|market|outcome|team|field|other|draw tie)$/.test(normalizedName)) return true;
  const normalizedTitle = normalizeOutcomeText(marketTitle);
  if (!normalizedTitle) return false;
  if (normalizedName === normalizedTitle || normalizedName === `${normalizedTitle} ${index + 1}`) return true;
  const titleWords = normalizedTitle.split(" ");
  return normalizedName.split(" ").length <= 2 && titleWords.slice(0, 2).join(" ").startsWith(normalizedName);
}

function chooseOutcomeName(tokenName: string, rawName: string, marketTitle: string, index: number) {
  if (tokenName && !isUnhelpfulOutcomeName(tokenName, marketTitle, index)) return tokenName;
  if (rawName && !isUnhelpfulOutcomeName(rawName, marketTitle, index)) return rawName;
  return tokenName || rawName || fallbackOutcomeName(index);
}

function buildOutcomeOptions(raw: GammaMarket) {
  const title = asString(pick(raw, ["question", "title", "q", "name"]), "");
  const conditionId = asString(pick(raw, ["conditionId", "condition_id", "id", "c"]), "");
  const marketId = asString(pick(raw, ["id", "market", "marketId", "questionID", "question_id"], conditionId), conditionId);
  const rawOutcomes = parseStringArray(raw.outcomes);
  const rawPrices = parseNumberArray(raw.outcomePrices);
  const rawTokenIds = parseStringArray(raw.clobTokenIds);
  const tokens = parseArray(raw.tokens);
  const length = Math.max(rawOutcomes.length, rawPrices.length, rawTokenIds.length, tokens.length);

  const options = Array.from({ length }, (_, index) => {
    const token = tokenRecordAt(tokens, index);
    const name = chooseOutcomeName(tokenOutcomeName(token), rawOutcomes[index] ?? "", title, index);
    const price = rawPrices[index] ?? tokenPrice(token);
    const tokenId = rawTokenIds[index] || tokenIdFromRecord(token);
    const bestBid = asNumber(pick(token, ["bestBid", "best_bid"], Number.NaN), Number.NaN);
    const bestAsk = asNumber(pick(token, ["bestAsk", "best_ask"], Number.NaN), Number.NaN);
    return {
      name: name.trim() || fallbackOutcomeName(index),
      price,
      tokenId,
      ...(marketId ? { marketId } : {}),
      ...(conditionId ? { conditionId } : {}),
      ...(Number.isFinite(bestBid) ? { bestBid } : {}),
      ...(Number.isFinite(bestAsk) ? { bestAsk } : {}),
    };
  }).filter((option) => option.name && Number.isFinite(option.price) && option.tokenId);

  return {
    outcomes: options.map((option) => option.name),
    prices: options.map((option) => option.price),
    tokenIds: options.map((option) => option.tokenId),
    outcomeOptions: options,
  };
}

function parseDate(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  if (!text) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00Z` : text.replace(" ", "T");
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function pickFirstDate(obj: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const parsed = parseDate(obj[key]);
    if (parsed) return parsed;
  }
  return null;
}

function resolveMarketTimes(raw: GammaMarket) {
  const events = parseArray(raw.events).filter((event): event is Record<string, unknown> => typeof event === "object" && event !== null);
  const marketStart = pickFirstDate(raw, ["eventStartTime", "gameStartTime", "startTime", "eventDate"]);
  const eventStart = events.map((event) => pickFirstDate(event, ["eventStartTime", "gameStartTime", "startTime", "startDate", "eventDate"])).find(Boolean) ?? null;
  const fallbackMarketStart = pickFirstDate(raw, ["startDate", "startDateIso", "start_date_iso"]);
  const startTime = marketStart ?? eventStart ?? fallbackMarketStart;

  const marketEnd = pickFirstDate(raw, ["gameEndTime", "endTime", "endDate", "endDateIso"]);
  const eventEnd = events.map((event) => pickFirstDate(event, ["gameEndTime", "endTime", "endDate"])).find(Boolean) ?? null;

  return {
    startTime,
    endTime: marketEnd ?? eventEnd,
  };
}

export function classifyMarketStatus(raw: GammaMarket, nowMs = Date.now()): MarketStatus {
  const { startTime, endTime } = resolveMarketTimes(raw);
  if (!startTime) return "stale";
  if (endTime && endTime.getTime() < nowMs) return "stale";
  return startTime.getTime() > nowMs ? "upcoming" : "live";
}

function hasStrictSportsSignal(raw: GammaMarket, title: string, slug: string, tags: unknown[], haystack: string) {
  const tagLabels = tags
    .map((tag) => (tag && typeof tag === "object" ? (tag as Record<string, unknown>).label : tag))
    .map((tag) => String(tag ?? ""))
    .filter(Boolean);

  return sportsTerms.some((term) => haystack.includes(term)) || hasSportsSignal({
    title,
    slug,
    category: asString(pick(raw, ["category", "subcategory"], "")),
    tags: tagLabels,
  });
}

function isClosedLike(raw: GammaMarket) {
  return raw.__eventClosed === true || raw.closed === true || raw.isClosed === true || raw.archived === true || raw.resolved === true;
}

function getMarketEligibility(raw: GammaMarket): MarketEligibility {
  const title = asString(pick(raw, ["question", "title", "q", "name"]), "");
  const slug = asString(pick(raw, ["market_slug", "slug"]), title.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
  const events = parseArray(raw.events);
  const tags = parseArray(raw.tags);
  const eventText = events.map((event) => JSON.stringify(event)).join(" ");
  const tagText = tags.map((tag) => JSON.stringify(tag)).join(" ");
  const haystack = `${title} ${slug} ${eventText} ${tagText} ${pick(raw, ["category", "subcategory"], "")}`.toLowerCase();
  const { outcomes, prices, tokenIds, outcomeOptions } = buildOutcomeOptions(raw);
  const isSports = hasStrictSportsSignal(raw, title, slug, tags, haystack);
  const closed = isClosedLike(raw);

  if (!isSports) {
    return { isSports: false, isOpenSports: false, excludedReason: null, outcomes, prices, tokenIds, outcomeOptions };
  }

  if (closed) {
    return { isSports: true, isOpenSports: false, excludedReason: "closed", outcomes, prices, tokenIds, outcomeOptions };
  }

  if (raw.active !== true || raw.acceptingOrders === false || raw.tradingEnabled === false) {
    return { isSports: true, isOpenSports: true, excludedReason: "inactive", outcomes, prices, tokenIds, outcomeOptions };
  }

  if (pick(raw, ["enableOrderBook", "enable_order_book"], true) === false) {
    return { isSports: true, isOpenSports: true, excludedReason: "noOrderbook", outcomes, prices, tokenIds, outcomeOptions };
  }

  if (tokenIds.length < 2) {
    return { isSports: true, isOpenSports: true, excludedReason: "missingClobTokenIds", outcomes, prices, tokenIds, outcomeOptions };
  }

  if (outcomes.length < 2 || prices.length < 2 || !prices.some((price) => price > 0.01 && price < 0.99)) {
    return { isSports: true, isOpenSports: true, excludedReason: "invalidPrices", outcomes, prices, tokenIds, outcomeOptions };
  }

  return { isSports: true, isOpenSports: true, excludedReason: null, outcomes, prices, tokenIds, outcomeOptions };
}

function inferSport(text: string) {
  const lower = text.toLowerCase();
  if (lower.includes("nba") || lower.includes("basketball")) return "Basketball";
  if (lower.includes("nfl") || lower.includes("football")) return "Football";
  if (lower.includes("mlb") || lower.includes("baseball")) return "Baseball";
  if (lower.includes("nhl") || lower.includes("hockey")) return "Hockey";
  if (lower.includes("ncaa") || lower.includes("ncaaf") || lower.includes("ncaab")) return "NCAA";
  if (lower.includes("soccer") || lower.includes("league") || lower.includes("cup")) return "Soccer";
  if (lower.includes("ufc") || lower.includes("mma") || lower.includes("fight")) return "MMA";
  if (lower.includes("tennis")) return "Tennis";
  if (lower.includes("golf")) return "Golf";
  return "Sports";
}

function inferLeague(text: string, sport: string) {
  const upper = text.toUpperCase();
  for (const league of ["NBA", "NFL", "MLB", "NHL", "NCAA", "UFC", "MMA", "EPL", "UCL", "MLS", "F1"]) {
    if (upper.includes(league)) return league;
  }
  return sport;
}

function matchesSportFilter(market: TerminalMarket, sport?: string) {
  if (!sport || sport.toLowerCase() === "all") return true;
  const normalized = sport.toLowerCase();
  const haystack = `${market.sport} ${market.league} ${market.title}`.toLowerCase();
  if (normalized === "nba") return haystack.includes("nba") || haystack.includes("basketball");
  if (normalized === "nfl") return haystack.includes("nfl") || haystack.includes("football");
  if (normalized === "soccer") return haystack.includes("soccer") || haystack.includes("league") || haystack.includes("cup");
  if (normalized === "ufc") return haystack.includes("ufc") || haystack.includes("mma");
  if (normalized === "tennis") return haystack.includes("tennis");
  return haystack.includes(normalized);
}

function compareMarkets(sort: MarketQuerySort) {
  return (a: TerminalMarket, b: TerminalMarket) => {
    if (sort === "volume") return b.volume24h - a.volume24h;
    if (sort === "liquidity") return b.liquidity - a.liquidity;
    if (sort === "movement") return Math.abs(b.priceMove24h) - Math.abs(a.priceMove24h);
    if (sort === "spread") return a.spread - b.spread;
    return b.opportunityScore - a.opportunityScore;
  };
}

function normalizeMinVolume(minVolume: number | undefined) {
  if (!Number.isFinite(minVolume)) return DEFAULT_MARKET_MIN_VOLUME;
  return Math.max(0, Math.trunc(minVolume as number));
}

function getMarketVolume(market: TerminalMarket) {
  return Number.isFinite(market.volume) ? market.volume : 0;
}

function buildMarketCountsForDiscovery(discovery: SportsMarketDiscovery, minVolume = DEFAULT_MARKET_MIN_VOLUME): MarketDiscoveryCounts {
  const threshold = normalizeMinVolume(minVolume);
  const counts = createMarketDiscoveryCounts();
  const sportsMarkets = discovery.debugMarkets.filter((market) => market.status !== "stale");
  const marketsWithMinVolume = discovery.markets.filter((market) => getMarketVolume(market) >= threshold);
  counts.totalEligibleSportsMarkets = discovery.debugMarkets.length;
  counts.marketsWithMinVolume = marketsWithMinVolume.length;
  counts.liveWithMinVolume = marketsWithMinVolume.filter((market) => market.status === "live").length;
  counts.upcomingWithMinVolume = marketsWithMinVolume.filter((market) => market.status === "upcoming").length;
  counts.staleExcluded = discovery.debugMarkets.filter((market) => market.status === "stale").length;
  counts.minVolume = threshold;
  counts.displayedMarkets = marketsWithMinVolume.length;
  counts.tradableSportsMarkets = discovery.debugMarkets.length;
  counts.liveSportsMarkets = sportsMarkets.filter((market) => market.status === "live").length;
  counts.upcomingSportsMarkets = sportsMarkets.filter((market) => market.status === "upcoming").length;
  counts.staleOrUnknownSportsMarkets = counts.staleExcluded;
  counts.tradableMarkets = discovery.debugMarkets.length;
  counts.openSportsMarkets = discovery.debugMarkets.length;
  return counts;
}

export function getMarketPage(discovery: SportsMarketDiscovery, params: MarketQueryParams = {}): MarketPage {
  const includeStale = params.includeStale === true;
  const status = params.status ?? "all";
  const sort = params.sort ?? "opportunity";
  const rawLimit = Number.isFinite(params.limit) ? Math.trunc(params.limit as number) : DEFAULT_MARKET_PAGE_LIMIT;
  const rawOffset = Number.isFinite(params.offset) ? Math.trunc(params.offset as number) : 0;
  const minVolume = normalizeMinVolume(params.minVolume);
  const limit = Math.min(Math.max(rawLimit, 1), MAX_MARKET_PAGE_LIMIT);
  const offset = Math.max(rawOffset, 0);
  const search = params.search?.trim().toLowerCase() ?? "";
  const sourceMarkets = includeStale ? discovery.debugMarkets : discovery.markets;

  const filtered = sourceMarkets.filter((market) => {
    if (!includeStale && market.status === "stale") return false;
    if (status !== "all" && market.status !== status) return false;
    if (getMarketVolume(market) < minVolume) return false;
    if (!matchesSportFilter(market, params.sport)) return false;
    if (!search) return true;
    const optionText = (market.outcomeOptions ?? []).map((outcome) => outcome.name).join(" ");
    const text = `${market.title} ${market.outcomes.yes} ${market.outcomes.no} ${optionText} ${market.league} ${market.sport}`.toLowerCase();
    return text.includes(search);
  });

  const sorted = [...filtered].sort(compareMarkets(sort));
  const markets = sorted.slice(offset, offset + limit);

  return {
    markets,
    limit,
    offset,
    total: sorted.length,
    returned: markets.length,
    hasMore: offset + markets.length < sorted.length,
  };
}

export async function enrichMarketOutcomeLogos(markets: TerminalMarket[]): Promise<TerminalMarket[]> {
  return Promise.all(
    markets.map(async (market) => {
      if (!market.outcomeOptions?.length) return market;

      const outcomeOptions = await Promise.all(
        market.outcomeOptions.map(async (outcome) => {
          if (outcome.outcomeLogoUrl || outcome.logoSource) return outcome;
          const logo = await resolveSportsLogo({
            marketTitle: market.title,
            outcomeName: outcome.name,
            category: market.league,
            sport: market.sport,
          });
          const confidentLogo = ["exact_normalized_match", "alias_match", "league_team_match"].includes(logo.confidence);
          return {
            ...outcome,
            ...(logo.logoUrl && confidentLogo ? { outcomeLogoUrl: logo.logoUrl } : {}),
            ...(logo.teamDisplayName ? { teamDisplayName: logo.teamDisplayName } : {}),
            logoSource: logo.logoSource,
            logoConfidence: logo.confidence,
          };
        }),
      );

      return {
        ...market,
        outcomeOptions,
      };
    }),
  );
}

type FastMarketPageResult = MarketsApiPayload & {
  rawFetched: number;
  sportsMatched: number;
  volumeMatched: number;
  pagesFetched: number;
  stopReason: "end" | "max_pages";
  requestDurationMs: number;
};

async function fetchGammaSportsEventPage(offset: number, limit = GAMMA_SPORTS_EVENTS_PAGE_LIMIT) {
  const params = new URLSearchParams({
    active: "true",
    closed: "false",
    order: "volume",
    ascending: "false",
    limit: String(limit),
    offset: String(offset),
  });
  const response = await fetch(`${GAMMA_HOST}/events?${params.toString()}`, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Gamma events fetch failed with status ${response.status}`);
  }
  return (await response.json()) as GammaEvent[];
}

function getGammaEventVolume(event: GammaEvent) {
  return asNumber(pick(event, ["volume", "volumeNum", "volume24hr"], 0));
}

function getFieldText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(getFieldText).join(" ");
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return [
      record.label,
      record.name,
      record.title,
      record.slug,
      record.ticker,
      record.category,
      record.subCategory,
      record.subcategory,
    ].map(getFieldText).join(" ");
  }
  return "";
}

function buildSportsSignalText(event: GammaEvent, market?: GammaMarket) {
  const eventFields = [
    event.category,
    event.subCategory,
    event.subcategory,
    event.tags,
    event.series,
    event.title,
    event.slug,
    event.ticker,
  ];
  const marketFields = market
    ? [
        market.category,
        market.subCategory,
        market.subcategory,
        market.tags,
        market.series,
        market.question,
        market.title,
        market.slug,
        market.market_slug,
        market.groupItemTitle,
        market.sportsMarketType,
      ]
    : [];
  return [...eventFields, ...marketFields].map(getFieldText).join(" ").toLowerCase();
}

function hasSportsKeyword(text: string) {
  return sportsTerms.some((term) => {
    const pattern = term
      .split(/[\s-]+/)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("[\\s-]+");
    return new RegExp(`(^|[^a-z0-9])${pattern}([^a-z0-9]|$)`, "i").test(text);
  });
}

function isSportsEvent(event: GammaEvent) {
  const eventText = buildSportsSignalText(event);
  if (hasSportsKeyword(eventText)) return true;
  return (event.markets ?? []).some((market) => hasSportsKeyword(buildSportsSignalText(event, market)));
}

function augmentEventMarket(event: GammaEvent, market: GammaMarket, eventVolume: number): GammaMarket {
  return {
    ...market,
    __eventClosed: event.closed,
    category: pick(market, ["category", "subcategory"], pick(event, ["category", "subcategory"], "Sports")),
    tags: market.tags ?? event.tags,
    events: [
      {
        slug: event.slug,
        tags: event.tags,
        title: event.title,
        category: event.category,
        closed: event.closed,
        startDate: event.startDate,
        endDate: event.endDate,
        startTime: event.startTime,
        eventDate: event.eventDate,
        gameStartTime: event.gameStartTime,
        series: event.series,
      },
    ],
    eventStartTime: pick(event, ["startTime", "gameStartTime", "eventStartTime", "eventDate", "startDate"]),
    gameStartTime: pick(event, ["gameStartTime", "startTime", "eventStartTime", "eventDate"]),
    startTime: pick(event, ["startTime", "gameStartTime", "eventStartTime", "eventDate", "startDate"], market.startTime),
    startDate: pick(event, ["startTime", "gameStartTime", "eventStartTime", "eventDate", "startDate"], market.startDate),
    endDate: undefined,
    endDateIso: undefined,
    gameEndTime: undefined,
    volume: eventVolume,
    volumeNum: eventVolume,
    volume24hr: asNumber(pick(event, ["volume24hr", "volume24h"], pick(market, ["volume24hr", "volume24h"], eventVolume))),
    liquidity: asNumber(pick(event, ["liquidity", "liquidityNum"], pick(market, ["liquidity", "liquidityNum"], 0))),
    liquidityNum: asNumber(pick(event, ["liquidity", "liquidityNum"], pick(market, ["liquidity", "liquidityNum"], 0))),
    image: pick(event, ["image", "icon"], market.image),
    icon: pick(event, ["icon", "image"], market.icon),
  };
}

function marketPreferenceScore(market: GammaMarket) {
  const type = asString(pick(market, ["sportsMarketType", "groupItemTitle", "question", "slug"], "")).toLowerCase();
  const volume = asNumber(pick(market, ["volume", "volumeNum"], 0));
  const typeBonus = type.includes("moneyline") || type.includes("winner") ? 1_000_000_000 : 0;
  return typeBonus + volume;
}

function isBinaryGenericOutcomeName(name: string) {
  return /^(yes|no)$/i.test(name.trim());
}

function fieldOutcomeName(value: unknown, eventTitle: string, index: number) {
  const text = asString(value, "").replace(/\s+/g, " ").trim();
  if (!text || isBinaryGenericOutcomeName(text) || isUnhelpfulOutcomeName(text, eventTitle, index)) return "";
  return text;
}

function labelFromMarketQuestion(question: string, eventTitle: string, index: number) {
  const afterColon = question.split(/[:|–-]\s*/).map((item) => item.trim()).filter(Boolean).at(-1) ?? "";
  const colonLabel = fieldOutcomeName(afterColon, eventTitle, index);
  if (colonLabel) return colonLabel;

  const escapedTitle = eventTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const cleaned = question
    .replace(new RegExp(escapedTitle, "ig"), " ")
    .replace(/\b(will|to|win|wins|winner|champion|champions|league|market|yes|no)\b/gi, " ")
    .replace(/[?()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return fieldOutcomeName(cleaned, eventTitle, index);
}

function eventOutcomeLabel(raw: GammaMarket, normalized: TerminalMarket, eventTitle: string, index: number) {
  const directFields = [
    raw.groupItemTitle,
    raw.groupItemThreshold,
    raw.outcome,
    raw.name,
    raw.title,
  ];
  for (const field of directFields) {
    const label = fieldOutcomeName(field, eventTitle, index);
    if (label) return label;
  }

  const normalizedYes = fieldOutcomeName(normalized.outcomes.yes, eventTitle, index);
  if (normalizedYes) return normalizedYes;

  const question = asString(pick(raw, ["question", "q"], ""), "");
  return labelFromMarketQuestion(question, eventTitle, index) || fallbackOutcomeName(index);
}

function hasAggregationSignal(eventTitle: string, candidates: Array<{ market: GammaMarket; normalized: TerminalMarket }>) {
  const title = eventTitle.toLowerCase();
  if (/\b(winner|champion|champions|outright|who will win|which team|where will)\b/.test(title)) return true;
  return candidates.length > 1 && candidates.every((candidate) => fieldOutcomeName(candidate.market.groupItemTitle, eventTitle, 0));
}

function aggregateEventMarkets(event: GammaEvent, candidates: Array<{ market: GammaMarket; normalized: TerminalMarket; score: number }>): TerminalMarket | null {
  const eventTitle = asString(pick(event, ["title", "ticker", "slug"], ""), "");
  if (!hasAggregationSignal(eventTitle, candidates)) return null;

  const seen = new Set<string>();
  const outcomeOptions = candidates
    .map(({ market, normalized }, index): NormalizedMarketOutcome | null => {
      const yesOption = normalized.outcomeOptions?.[0];
      const name = eventOutcomeLabel(market, normalized, eventTitle, index);
      const normalizedName = normalizeOutcomeText(name);
      if (!normalizedName || seen.has(normalizedName)) return null;
      seen.add(normalizedName);
      const tokenId = yesOption?.tokenId || normalized.tokenIds.yes;
      const price = yesOption?.price ?? normalized.yesPrice;
      if (!tokenId || !Number.isFinite(price)) return null;
      const bestBid = yesOption?.bestBid ?? normalized.bestBid;
      const bestAsk = yesOption?.bestAsk ?? normalized.bestAsk;
      return {
        name,
        price,
        tokenId,
        marketId: yesOption?.marketId ?? normalized.id,
        conditionId: yesOption?.conditionId ?? normalized.conditionId,
        ...(Number.isFinite(bestBid) ? { bestBid } : {}),
        ...(Number.isFinite(bestAsk) ? { bestAsk } : {}),
      };
    })
    .filter((outcome): outcome is NormalizedMarketOutcome => outcome !== null);

  if (outcomeOptions.length < 2) return null;

  const selected = [...candidates].sort((a, b) => b.score - a.score)[0]?.normalized;
  if (!selected) return null;

  const volume24h = asNumber(pick(event, ["volume24hr", "volume24h"], selected.volume24h), selected.volume24h);
  const volume = getGammaEventVolume(event);
  const volume1wk = asNumber(pick(event, ["volume1wk", "volume_1wk"], selected.volume1wk), selected.volume1wk);
  const liquidity = asNumber(pick(event, ["liquidity", "liquidityNum"], selected.liquidity), selected.liquidity);
  const acceleration = volumeAcceleration(volume24h, volume1wk);
  const haystack = buildSportsSignalText(event);
  const sport = inferSport(haystack);
  const eventSlug = asString(pick(event, ["slug", "ticker"], ""), eventTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
  const first = outcomeOptions[0];
  const second = outcomeOptions[1] ?? outcomeOptions[0];
  const spread = outcomeOptions
    .map((outcome) => (Number.isFinite(outcome.bestBid) && Number.isFinite(outcome.bestAsk) ? (outcome.bestAsk as number) - (outcome.bestBid as number) : Number.NaN))
    .filter(Number.isFinite)
    .sort((a, b) => a - b)[0] ?? selected.spread;

  return {
    ...selected,
    id: eventSlug || String(event.id ?? selected.id),
    conditionId: selected.conditionId,
    slug: eventSlug || selected.slug,
    title: eventTitle || selected.title,
    sport,
    league: inferLeague(haystack, sport),
    startTime: (pickFirstDate(event, ["startTime", "gameStartTime", "eventStartTime", "eventDate", "startDate"]) ?? parseDate(selected.startTime))?.toISOString() ?? selected.startTime,
    endTime: null,
    status: classifyMarketStatus({ startTime: pick(event, ["startTime", "gameStartTime", "eventStartTime", "eventDate", "startDate"], selected.startTime) }),
    yesPrice: Math.max(0.01, Math.min(0.99, first.price)),
    noPrice: Math.max(0.01, Math.min(0.99, second.price)),
    volume,
    volume24h,
    volume1wk,
    liquidity,
    volumeAcceleration: acceleration,
    spread,
    opportunityScore: opportunityScore({
      liquidity,
      volume: volume24h,
      priceMove24h: selected.priceMove24h,
      recentTrades: selected.recentTradesCount,
      spread,
      volumeAcceleration: acceleration,
    }),
    outcomes: {
      yes: first.name,
      no: second.name,
    },
    tokenIds: {
      yes: first.tokenId,
      no: second.tokenId,
    },
    outcomeOptions,
    image: asString(pick(event, ["image", "icon"], selected.image), selected.image),
  };
}

export function normalizeGammaSportsEvent(event: GammaEvent): TerminalMarket | null {
  const eventVolume = getGammaEventVolume(event);
  const eventTitle = asString(pick(event, ["title", "ticker", "slug"], ""), "");
  const eventSlug = asString(pick(event, ["slug", "ticker"], ""), eventTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
  const markets = (event.markets ?? []).filter((market): market is GammaMarket => typeof market === "object" && market !== null);

  const candidates = markets
    .map((market) => ({ market: augmentEventMarket(event, market, eventVolume), score: marketPreferenceScore(market) }))
    .map(({ market, score }) => ({ market, normalized: normalizeGammaMarket(market), score }))
    .filter((item): item is { market: GammaMarket; normalized: TerminalMarket; score: number } => item.normalized !== null)
    .sort((a, b) => b.score - a.score);

  const aggregated = aggregateEventMarkets(event, candidates);
  if (aggregated) return aggregated;

  const selected = candidates[0]?.normalized;
  if (!selected) return null;

  const volume24h = asNumber(pick(event, ["volume24hr", "volume24h"], selected.volume24h), selected.volume24h);
  const volume1wk = asNumber(pick(event, ["volume1wk", "volume_1wk"], selected.volume1wk), selected.volume1wk);
  const liquidity = asNumber(pick(event, ["liquidity", "liquidityNum"], selected.liquidity), selected.liquidity);
  const acceleration = volumeAcceleration(volume24h, volume1wk);
  const title = eventTitle || selected.title;
  const haystack = buildSportsSignalText(event);
  const sport = inferSport(haystack);

  return {
    ...selected,
    title,
    slug: eventSlug || selected.slug,
    sport,
    league: inferLeague(haystack, sport),
    startTime: (pickFirstDate(event, ["startTime", "gameStartTime", "eventStartTime", "eventDate", "startDate"]) ?? parseDate(selected.startTime))?.toISOString() ?? selected.startTime,
    endTime: null,
    status: classifyMarketStatus({ startTime: pick(event, ["startTime", "gameStartTime", "eventStartTime", "eventDate", "startDate"], selected.startTime) }),
    volume: eventVolume,
    volume24h,
    volume1wk,
    liquidity,
    volumeAcceleration: acceleration,
    opportunityScore: opportunityScore({
      liquidity,
      volume: volume24h,
      priceMove24h: selected.priceMove24h,
      recentTrades: selected.recentTradesCount,
      spread: selected.spread,
      volumeAcceleration: acceleration,
    }),
    image: asString(pick(event, ["image", "icon"], selected.image), selected.image),
  };
}

export async function getLiveSportsMarketsApiPayload(params: MarketQueryParams = {}): Promise<FastMarketPageResult> {
  const requestStartedAt = Date.now();
  const minVolume = Math.max(DEFAULT_MARKET_MIN_VOLUME, normalizeMinVolume(params.minVolume));
  const sportsEvents: GammaEvent[] = [];
  const volumeMatchedEvents: GammaEvent[] = [];
  const collectedMarkets: TerminalMarket[] = [];
  let rawFetched = 0;
  let pagesFetched = 0;
  let currentOffset = 0;
  let stopReason: FastMarketPageResult["stopReason"] = "end";

  while (true) {
    const page = await fetchGammaSportsEventPage(currentOffset);
    pagesFetched += 1;
    rawFetched += page.length;

    const pageSportsEvents = page.filter(isSportsEvent);
    sportsEvents.push(...pageSportsEvents);
    volumeMatchedEvents.push(...pageSportsEvents.filter((event) => getGammaEventVolume(event) >= minVolume));

    if (page.length < GAMMA_SPORTS_EVENTS_PAGE_LIMIT) {
      stopReason = "end";
      break;
    }
    currentOffset += page.length;
    if (pagesFetched >= GAMMA_SPORTS_EVENTS_MAX_PAGES) {
      stopReason = "max_pages";
      break;
    }
  }

  for (const event of volumeMatchedEvents) {
    const normalized = normalizeGammaSportsEvent(event);
    if (normalized && normalized.status !== "stale") {
      collectedMarkets.push(normalized);
    }
  }

  const discovery = createMarketDiscoveryFromMarkets(collectedMarkets);
  const counts = buildMarketCountsForDiscovery(discovery, minVolume);
  counts.eventPagesFetched = pagesFetched;
  counts.eventsFetched = rawFetched;
  counts.rawMarkets = volumeMatchedEvents.reduce((total, event) => total + (event.markets?.length ?? 0), 0);
  counts.sportsMarkets = sportsEvents.length;
  counts.openSportsMarkets = sportsEvents.length;
  counts.tradableMarkets = collectedMarkets.length;
  counts.tradableSportsMarkets = collectedMarkets.length;
  counts.displayedMarkets = collectedMarkets.length;

  const page = getMarketPage(discovery, { ...params, minVolume });
  const markets = await enrichMarketOutcomeLogos(page.markets);
  const requestDurationMs = Date.now() - requestStartedAt;

  if (process.env.NODE_ENV !== "production") {
    console.log("[Traak] live sports market page", {
      pagesFetched,
      rawFetched,
      sportsMatched: sportsEvents.length,
      volumeMatched: volumeMatchedEvents.length,
      rawMarkets: counts.rawMarkets,
      minVolume,
      returned: page.returned,
      stopReason,
      requestDurationMs,
    });
  }

  return {
    counts,
    countsLoading: false,
    source: "polymarket",
    ...page,
    markets,
    rawFetched,
    sportsMatched: sportsEvents.length,
    volumeMatched: volumeMatchedEvents.length,
    pagesFetched,
    stopReason,
    requestDurationMs,
  };
}

export function normalizeGammaMarket(raw: GammaMarket): TerminalMarket | null {
  const title = asString(pick(raw, ["question", "title", "q", "name"]), "");
  const slug = asString(pick(raw, ["market_slug", "slug"]), title.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
  const events = parseArray(raw.events);
  const tags = parseArray(raw.tags);
  const eventText = events.map((event) => JSON.stringify(event)).join(" ");
  const tagText = tags.map((tag) => JSON.stringify(tag)).join(" ");
  const haystack = `${title} ${slug} ${eventText} ${tagText} ${pick(raw, ["category", "subcategory"], "")}`.toLowerCase();
  const eligibility = getMarketEligibility(raw);
  if (!eligibility.isSports || eligibility.excludedReason) return null;

  const conditionId = asString(pick(raw, ["conditionId", "condition_id", "id", "c"]), slug);
  const outcomes = eligibility.outcomes;
  const prices = eligibility.prices;
  const tokenIds = eligibility.tokenIds;
  const outcomeOptions = eligibility.outcomeOptions;
  const yesPrice = asNumber(pick(raw, ["bestAsk", "best_ask", "lastTradePrice", "last_trade_price"], prices[0] ?? 0.5), prices[0] ?? 0.5);
  const noPrice = prices[1] ?? Math.max(0.01, 1 - yesPrice);
  const volume24h = asNumber(pick(raw, ["volume_24hr", "volume24hr", "volume24h", "volumeNum", "volume_num"], 0));
  const volume = asNumber(pick(raw, ["volume", "totalVolume", "total_volume", "volumeNum", "volume_num"], volume24h));
  const volume1wk = asNumber(pick(raw, ["volume1wk", "volume_1wk"], Math.max(volume24h, volume / 4)));
  const liquidity = asNumber(pick(raw, ["liquidity", "liquidityNum", "liquidity_num", "rewards_min_size"], 0));
  const priceMove24h = asNumber(pick(raw, ["oneDayPriceChange", "price_change_24hr", "priceChange24h", "one_day_price_change"], 0));
  const bestBid = asNumber(pick(raw, ["bestBid", "best_bid"], Number.NaN), Number.NaN);
  const bestAsk = asNumber(pick(raw, ["bestAsk", "best_ask"], Number.NaN), Number.NaN);
  const spread = asNumber(pick(raw, ["spread"], Math.abs(asNumber(pick(raw, ["bestAsk"], yesPrice)) - asNumber(pick(raw, ["bestBid"], yesPrice)))), 0.04);
  const recentTradesCount = asNumber(pick(raw, ["trades_count", "recent_trades_count"], Math.max(10, volume24h / 5000)));
  const times = resolveMarketTimes(raw);
  const startTime = times.startTime?.toISOString() ?? "";
  const endTime = times.endTime?.toISOString() ?? null;
  const status = classifyMarketStatus(raw);
  const sport = inferSport(haystack);
  const acceleration = volumeAcceleration(volume24h, volume1wk);

  return {
    id: conditionId || String(raw.id ?? slug),
    conditionId,
    slug,
    title,
    sport,
    league: inferLeague(haystack, sport),
    status,
    startTime,
    endTime,
    yesPrice: Math.max(0.01, Math.min(0.99, yesPrice)),
    noPrice: Math.max(0.01, Math.min(0.99, noPrice)),
    volume24h,
    volume,
    liquidity,
    priceMove24h,
    volume1wk,
    volumeAcceleration: acceleration,
    spread,
    ...(Number.isFinite(bestBid) ? { bestBid } : {}),
    ...(Number.isFinite(bestAsk) ? { bestAsk } : {}),
    recentTradesCount,
    opportunityScore: opportunityScore({
      liquidity,
      volume: volume24h,
      priceMove24h,
      recentTrades: recentTradesCount,
      spread,
      volumeAcceleration: acceleration,
    }),
    outcomes: {
      yes: outcomes[0] || fallbackOutcomeName(0),
      no: outcomes[1] || fallbackOutcomeName(1),
    },
    tokenIds: {
      yes: tokenIds[0] || "",
      no: tokenIds[1] || "",
    },
    outcomeOptions,
    image: asString(pick(raw, ["image", "icon"], "")),
    source: "polymarket",
  };
}

function createMarketDiscoveryCounts(): MarketDiscoveryCounts {
  return {
    eventPagesFetched: 0,
    eventsFetched: 0,
    rawMarkets: 0,
    sportsMarkets: 0,
    openSportsMarkets: 0,
    tradableMarkets: 0,
    tradableSportsMarkets: 0,
    liveSportsMarkets: 0,
    upcomingSportsMarkets: 0,
    staleOrUnknownSportsMarkets: 0,
    displayedMarkets: 0,
    totalEligibleSportsMarkets: 0,
    marketsWithMinVolume: 0,
    liveWithMinVolume: 0,
    upcomingWithMinVolume: 0,
    staleExcluded: 0,
    minVolume: DEFAULT_MARKET_MIN_VOLUME,
    excludedClosed: 0,
    excludedInactive: 0,
    excludedMissingClobTokenIds: 0,
    excludedNoOrderbook: 0,
    excludedInvalidPrices: 0,
  };
}

export function createEmptyMarketCounts(): MarketDiscoveryCounts {
  return createMarketDiscoveryCounts();
}

export function createEmptyMarketPage(): MarketPage {
  return {
    markets: [],
    limit: DEFAULT_MARKET_PAGE_LIMIT,
    offset: 0,
    total: 0,
    returned: 0,
    hasMore: false,
  };
}

function logMarketDiscoveryCounts(counts: MarketDiscoveryCounts) {
  if (process.env.NODE_ENV === "production") return;
  console.log("[Traak] market discovery counts", counts);
}

function collectRawDateFields(source: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(source).filter(([key]) => /date|time|start|end|close|game/i.test(key)),
  );
}

function logRawDateSamples(allEvents: GammaEvent[]) {
  if (process.env.NODE_ENV === "production") return;
  const samples = allEvents
    .filter((event) => {
      const eventText = JSON.stringify({ title: event.title, slug: event.slug, tags: event.tags, category: event.category, series: event.series }).toLowerCase();
      return sportsTerms.some((term) => eventText.includes(term)) || hasSportsSignal({
        title: asString(event.title),
        slug: asString(event.slug),
        category: asString(event.category),
        tags: parseArray(event.tags).map((tag) => String((tag as Record<string, unknown>)?.label ?? tag ?? "")),
      });
    })
    .slice(0, 5)
    .map((event) => ({
      event: {
        id: event.id,
        slug: event.slug,
        title: event.title,
        dateFields: collectRawDateFields(event),
      },
      markets: (event.markets ?? []).slice(0, 2).map((market) => ({
        id: market.id,
        slug: market.slug,
        question: market.question,
        dateFields: collectRawDateFields(market),
      })),
    }));
  console.log("[Traak] raw Gamma sports date samples", samples);
}

function createMockDiscovery(): SportsMarketDiscovery {
  const counts = buildMarketCountsForDiscovery({
    markets: mockMarkets,
    debugMarkets: mockMarkets,
    counts: createMarketDiscoveryCounts(),
    source: "mock",
  }, DEFAULT_MARKET_MIN_VOLUME);
  return {
    markets: mockMarkets,
    debugMarkets: mockMarkets,
    counts,
    source: "mock",
  };
}

function createMarketDiscoveryFromMarkets(markets: TerminalMarket[]): SportsMarketDiscovery {
  return {
    markets,
    debugMarkets: markets,
    counts: createMarketDiscoveryCounts(),
    source: "polymarket",
  };
}

async function buildMarketSnapshot(): Promise<MarketSnapshot> {
  const discovery = await discoverSportsMarketDiscovery();
  const now = Date.now();
  return {
    discovery,
    refreshedAt: now,
    expiresAt: now + MARKET_SNAPSHOT_CACHE_MS,
  };
}

function startSnapshotRefresh() {
  const store = getMarketSnapshotStore();
  if (store.refreshPromise) return store.refreshPromise;
  if (process.env.NODE_ENV !== "production") {
    console.log("[Traak] market snapshot warmup started");
  }
  store.warmupStartedAt = Date.now();

  store.refreshPromise = buildMarketSnapshot()
    .then((snapshot) => {
      store.snapshot = { value: snapshot, expiresAt: snapshot.expiresAt };
      if (process.env.NODE_ENV !== "production" && store.warmupStartedAt) {
        console.log("[Traak] market snapshot warmup completed", {
          durationMs: Date.now() - store.warmupStartedAt,
        });
      }
      return snapshot;
    })
    .catch((error) => {
      if (process.env.NODE_ENV !== "production") {
        console.error("[Traak] market snapshot refresh failed", error);
      }
      throw error;
    })
    .finally(() => {
      store.refreshPromise = null;
      store.warmupStartedAt = null;
    });

  return store.refreshPromise;
}

async function discoverSportsMarketDiscovery(): Promise<SportsMarketDiscovery> {
  try {
    const allEvents: GammaEvent[] = [];
    let offset = 0;
    const counts = createMarketDiscoveryCounts();

    while (true) {
      const params = new URLSearchParams({
        closed: "false",
        order: "id",
        ascending: "false",
        limit: String(GAMMA_PAGE_LIMIT),
        offset: String(offset),
      });
      const response = await fetch(`${GAMMA_HOST}/events?${params.toString()}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`Gamma events fetch failed with status ${response.status}`);
      }
      const page = (await response.json()) as GammaEvent[];
      if (!page.length) break;
      counts.eventPagesFetched += 1;
      allEvents.push(...page);
      offset += page.length;
    }
    counts.eventsFetched = allEvents.length;

    const rawMarkets = allEvents.flatMap((event) =>
      (event.markets ?? []).map((market) => ({
        ...market,
        __eventClosed: event.closed,
        events: market.events ?? [{
          slug: event.slug,
          tags: event.tags,
          title: event.title,
          category: event.category,
          closed: event.closed,
          startDate: event.startDate,
          endDate: event.endDate,
          startTime: event.startTime,
          eventDate: event.eventDate,
          gameStartTime: event.gameStartTime,
        }],
        tags: market.tags ?? event.tags,
      })),
    );
    counts.rawMarkets = rawMarkets.length;

    logRawDateSamples(allEvents);

    const debugMarkets: TerminalMarket[] = [];

    for (const rawMarket of rawMarkets) {
      const eligibility = getMarketEligibility(rawMarket);
      if (eligibility.isSports) counts.sportsMarkets += 1;
      if (eligibility.isOpenSports) counts.openSportsMarkets += 1;

      if (eligibility.excludedReason === "closed") counts.excludedClosed += 1;
      if (eligibility.excludedReason === "inactive") counts.excludedInactive += 1;
      if (eligibility.excludedReason === "missingClobTokenIds") counts.excludedMissingClobTokenIds += 1;
      if (eligibility.excludedReason === "noOrderbook") counts.excludedNoOrderbook += 1;
      if (eligibility.excludedReason === "invalidPrices") counts.excludedInvalidPrices += 1;

      if (!eligibility.isSports || eligibility.excludedReason) continue;
      const market = normalizeGammaMarket(rawMarket);
      if (!market) continue;
      counts.tradableMarkets += 1;
      counts.tradableSportsMarkets += 1;
      if (market.status === "upcoming") counts.upcomingSportsMarkets += 1;
      if (market.status === "live") counts.liveSportsMarkets += 1;
      if (market.status === "stale") counts.staleOrUnknownSportsMarkets += 1;
    }

    for (const event of allEvents) {
      const market = normalizeGammaSportsEvent(event);
      if (market) debugMarkets.push(market);
    }

    debugMarkets.sort((a, b) => b.opportunityScore - a.opportunityScore);
    const markets = debugMarkets.filter((market) => market.status === "live" || market.status === "upcoming");
    counts.displayedMarkets = markets.length;
    const summaryCounts = buildMarketCountsForDiscovery(
      {
        markets,
        debugMarkets,
        counts,
        source: "polymarket",
      },
      DEFAULT_MARKET_MIN_VOLUME,
    );
    summaryCounts.eventPagesFetched = counts.eventPagesFetched;
    summaryCounts.eventsFetched = counts.eventsFetched;
    summaryCounts.rawMarkets = counts.rawMarkets;
    summaryCounts.sportsMarkets = counts.sportsMarkets;
    summaryCounts.openSportsMarkets = counts.openSportsMarkets;
    summaryCounts.tradableMarkets = counts.tradableMarkets;
    summaryCounts.tradableSportsMarkets = counts.tradableSportsMarkets;
    summaryCounts.liveSportsMarkets = counts.liveSportsMarkets;
    summaryCounts.upcomingSportsMarkets = counts.upcomingSportsMarkets;
    summaryCounts.staleOrUnknownSportsMarkets = counts.staleOrUnknownSportsMarkets;
    summaryCounts.displayedMarkets = counts.displayedMarkets;
    summaryCounts.excludedClosed = counts.excludedClosed;
    summaryCounts.excludedInactive = counts.excludedInactive;
    summaryCounts.excludedMissingClobTokenIds = counts.excludedMissingClobTokenIds;
    summaryCounts.excludedNoOrderbook = counts.excludedNoOrderbook;
    summaryCounts.excludedInvalidPrices = counts.excludedInvalidPrices;

    logMarketDiscoveryCounts(counts);

    return markets.length > 0 ? { markets, debugMarkets, counts: summaryCounts, source: "polymarket" } : createMockDiscovery();
  } catch {
    return createMockDiscovery();
  }
}

export async function fetchSportsMarketDiscovery(): Promise<SportsMarketDiscovery> {
  return discoverSportsMarketDiscovery();
}

export function getCachedMarketCountsSnapshot() {
  const store = getMarketSnapshotStore();
  return store.snapshot?.value.discovery.counts ?? createEmptyMarketCounts();
}

export function getCachedMarketCountsState(minVolume = DEFAULT_MARKET_MIN_VOLUME): MarketCountsApiResponse {
  const store = getMarketSnapshotStore();
  if (!store.snapshot) {
    return { loading: true };
  }
  return {
    loading: false,
    counts: buildMarketCountsForDiscovery(store.snapshot.value.discovery, minVolume),
    source: store.snapshot.value.discovery.source,
  };
}

export function getMarketCountsApiResponse(minVolume = DEFAULT_MARKET_MIN_VOLUME): MarketCountsApiResponse {
  const store = getMarketSnapshotStore();
  if (!store.snapshot) {
    void startSnapshotRefresh().catch(() => undefined);
    return { loading: true };
  }
  return {
    loading: false,
    counts: buildMarketCountsForDiscovery(store.snapshot.value.discovery, minVolume),
    source: store.snapshot.value.discovery.source,
  };
}

export function prewarmMarketSnapshot() {
  const store = getMarketSnapshotStore();
  const started = !store.refreshPromise;
  void startSnapshotRefresh().catch(() => undefined);
  return started;
}

export async function getCachedMarketsApiPayload(params: MarketQueryParams = {}): Promise<MarketsApiPayload> {
  return getLiveSportsMarketsApiPayload(params);
}

export function resetMarketSnapshotCache() {
  globalThis.__TRAAK_MARKET_SNAPSHOT__ = { snapshot: null, refreshPromise: null, warmupStartedAt: null };
}

export function seedMarketSnapshotCache(discovery: SportsMarketDiscovery, expiresAt = Date.now() + MARKET_SNAPSHOT_CACHE_MS) {
  globalThis.__TRAAK_MARKET_SNAPSHOT__ = {
    snapshot: {
      value: {
        discovery,
        refreshedAt: Date.now(),
        expiresAt,
      },
      expiresAt,
    },
    refreshPromise: null,
    warmupStartedAt: null,
  };
}

export async function fetchSportsMarkets(): Promise<TerminalMarket[]> {
  return enrichMarketOutcomeLogos((await fetchSportsMarketDiscovery()).markets);
}

export async function getMarketById(id: string) {
  const markets = await fetchSportsMarkets();
  return markets.find((market) => market.id === id || market.slug === id || market.conditionId === id) ?? mockMarkets[0];
}

function normalizeOrderbook(book: OrderBookSummary): NormalizedOrderbook {
  const mapSide = (levels: { price: string; size: string }[]) => {
    let running = 0;
    return levels.slice(0, 8).map((level) => {
      const size = asNumber(level.size);
      running += size;
      return { price: asNumber(level.price), size, total: running };
    });
  };

  return {
    bids: mapSide(book.bids ?? []),
    asks: mapSide(book.asks ?? []),
    tickSize: book.tick_size,
    minOrderSize: book.min_order_size,
    lastTradePrice: asNumber(book.last_trade_price),
  };
}

export async function fetchOrderbook(tokenId: string): Promise<NormalizedOrderbook> {
  if (!tokenId) return mockOrderbook;

  try {
    const client = createPolymarketClient({ throwOnError: true });
    return normalizeOrderbook(await client.getOrderBook(tokenId));
  } catch {
    return mockOrderbook;
  }
}

export async function fetchMarketChart(tokenId: string, seed = 0.52): Promise<MarketChartPoint[]> {
  if (!tokenId) return mockChart(seed);

  try {
    const client = createPolymarketClient({ throwOnError: true });
    const history = await client.getPricesHistory({
      market: tokenId,
      interval: PriceHistoryInterval.ONE_DAY,
      fidelity: 30,
    });

    const points = history.map((point) => ({
      time: new Date(point.t * 1000).toISOString(),
      yes: point.p,
      no: 1 - point.p,
    }));

    return points.length > 0 ? points : mockChart(seed);
  } catch {
    return mockChart(seed);
  }
}

export async function fetchRecentTrades(conditionId: string): Promise<RecentTrade[]> {
  if (!conditionId) return mockTrades;

  try {
    const client = createPolymarketClient({ throwOnError: true });
    const trades = await client.getMarketTradesEvents(conditionId);
    const normalized: RecentTrade[] = trades.slice(0, 12).map((trade, index) => ({
      id: trade.transaction_hash || `${conditionId}-${index}`,
      side: trade.side === Side.SELL ? "SELL" : "BUY",
      outcome: trade.outcome,
      price: asNumber(trade.price),
      size: asNumber(trade.size),
      timestamp: trade.timestamp,
      txHash: trade.transaction_hash,
    }));

    return normalized.length > 0 ? normalized : mockTrades;
  } catch {
    return mockTrades;
  }
}
