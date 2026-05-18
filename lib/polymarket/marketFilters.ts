const CLOSED_STATUSES = new Set(["closed", "resolved", "finalized", "settled"]);

type MarketLike = {
  status?: unknown;
  closed?: unknown;
  isClosed?: unknown;
  resolved?: unknown;
  archived?: unknown;
  active?: unknown;
  acceptingOrders?: unknown;
  tradingEnabled?: unknown;
  endDate?: unknown;
  end_time?: unknown;
  closeTime?: unknown;
  closedTime?: unknown;
  closesAt?: unknown;
};

const parseDateValue = (value: unknown) => {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
};

export function isMarketClosed(market?: MarketLike | null) {
  if (!market || typeof market !== "object") return false;
  const status = typeof market.status === "string" ? market.status.toLowerCase() : null;
  if (status && CLOSED_STATUSES.has(status)) return true;
  if (market.closed === true || market.isClosed === true || market.resolved === true || market.archived === true) return true;

  const closeDate = parseDateValue(market.closedTime ?? market.closeTime);
  return Boolean(closeDate && closeDate.getTime() <= Date.now());
}

export function isTradableMarket(market?: MarketLike | null) {
  if (!market || typeof market !== "object") return false;
  if (isMarketClosed(market)) return false;
  if (market.active === false) return false;
  if (market.acceptingOrders === false) return false;
  if (market.tradingEnabled === false) return false;
  return true;
}

const sportsSlugTokens = [
  "nba",
  "nfl",
  "mlb",
  "nhl",
  "ncaa",
  "ncaaf",
  "ncaab",
  "ufc",
  "mma",
  "tennis",
  "soccer",
  "epl",
  "premier-league",
  "ucl",
  "champions-league",
  "serie-a",
  "fifa",
  "uefa",
  "world-cup",
  "mls",
];

const hasSlugToken = (slug: string, token: string) => {
  const safeToken = token.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|-)${safeToken}(-|$)`, "i").test(slug);
};

export function hasSportsSignal(input: {
  title?: string;
  slug?: string;
  category?: string;
  tags?: string[];
}) {
  const title = input.title ?? "";
  const slug = input.slug ?? "";
  const category = input.category ?? "";
  const tags = input.tags ?? [];

  if (tags.some((label) => label.toLowerCase().includes("sports"))) return true;
  if (sportsSlugTokens.some((token) => hasSlugToken(slug, token))) return true;

  const matchCue =
    /\bwin\b/i.test(title) ||
    /\bvs\b/i.test(title) ||
    /(^|[\s(])v([\s).]|$)/i.test(title) ||
    /\bagainst\b/i.test(title) ||
    /\bmatch\b/i.test(title) ||
    /\bfinal\b/i.test(title) ||
    /\bscore\b/i.test(title) ||
    /\bgoal(?:s)?\b/i.test(title) ||
    /\btournament\b/i.test(title) ||
    /\bleague\b/i.test(title) ||
    /\bcup\b/i.test(title);
  const leagueCue = /\b(nba|nfl|mlb|nhl|ncaa|ufc|mma|tennis|soccer)\b/i.test(`${title} ${category}`);
  return matchCue && leagueCue;
}
