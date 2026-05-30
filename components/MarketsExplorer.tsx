"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ChevronDown, RefreshCw, Search, Sparkles } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { fetchLatestMarketForNode, MarketBubbleMap, marketToBubbleNode, type MarketBubbleNode } from "@/components/MarketBubbleMap";
import { MarketTradePanel } from "@/components/MarketTradePanel";
import { MarketMatchupLogos } from "@/components/market-logo-badge";
import { marketStore } from "@/app/store/marketStore";
import { categoryIcon, categoryIconSrc } from "@/lib/markets/category";
import { DEFAULT_MARKET_MIN_VOLUME, getMarketOutcomeVisuals, hasUsefulFavoredPrice, rankHighValueMarkets } from "@/lib/polymarket/marketDisplay";
import type { MarketPage, MarketQuerySort, MarketQueryStatus, SportsMarketDiscovery } from "@/lib/polymarket/markets";
import type { TerminalMarket } from "@/lib/polymarket/types";

const sports = ["NBA", "NFL", "Soccer", "UFC", "Tennis"] as const;
const sportPills = sports.map((label) => ({ label, icon: categoryIconSrc(label), fallback: categoryIcon(label) }));
const featuredCategories = [
  { title: "NBA Playoffs", sport: "NBA" as const, detail: "124 markets", icon: categoryIconSrc("NBA"), fallback: categoryIcon("NBA") },
  { title: "Champions League", sport: "Soccer" as const, detail: "88 markets", icon: categoryIconSrc("Soccer"), fallback: categoryIcon("Soccer") },
  { title: "UFC 315", sport: "UFC" as const, detail: "42 markets", icon: categoryIconSrc("UFC"), fallback: categoryIcon("UFC") },
  { title: "French Open", sport: "Tennis" as const, detail: "67 markets", icon: categoryIconSrc("Tennis"), fallback: categoryIcon("Tennis") },
] as const;
const rangeOptions = [
  { label: "1-50", start: 0, end: 50 },
  { label: "51-100", start: 50, end: 100 },
  { label: "101-150", start: 100, end: 150 },
  { label: "151-200", start: 150, end: 200 },
  { label: "201-250", start: 200, end: 250 },
] as const;
const maxMarketFetchLimit = rangeOptions[rangeOptions.length - 1].end;

export { hasUsefulFavoredPrice };

type MarketsResponse = MarketPage & {
  counts: SportsMarketDiscovery["counts"];
  countsLoading?: boolean;
  source: SportsMarketDiscovery["source"];
};

async function readMarketsResponse(response: Response): Promise<MarketsResponse> {
  const payload = (await response.json().catch(() => null)) as (Partial<MarketsResponse> & { error?: string }) | null;
  if (!response.ok) {
    throw new Error(payload?.error ?? "Unable to load Polymarket sports markets.");
  }
  if (!payload || !Array.isArray(payload.markets)) {
    throw new Error("Polymarket returned an unexpected sports market response.");
  }
  return payload as MarketsResponse;
}

function buildMarketsUrl(params: {
  offset: number;
  limit: number;
  sort: MarketQuerySort;
  sport: string;
  status: MarketQueryStatus;
  minVolume: number;
}) {
  const searchParams = new URLSearchParams({
    limit: String(params.limit),
    offset: String(params.offset),
    minVolume: String(params.minVolume),
    sort: params.sort,
    status: params.status,
  });
  if (params.sport !== "All") searchParams.set("sport", params.sport);
  return `/api/polymarket/markets?${searchParams.toString()}`;
}

function matchesMarketQuery(market: TerminalMarket, query: string) {
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) return false;
  const haystack = `${market.title} ${market.sport} ${market.league} ${market.outcomes.yes} ${market.outcomes.no}`.toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

function SportIcon({ src, fallback, className = "h-5 w-5" }: { src?: string; fallback?: string; className?: string }) {
  if (src) {
    return (
      <span className={`relative shrink-0 overflow-hidden rounded-full ${className}`}>
        <Image src={src} alt="" fill sizes="24px" className="object-contain" />
      </span>
    );
  }
  if (fallback) return <span className="shrink-0 text-base leading-none">{fallback}</span>;
  return <Sparkles className="h-4 w-4 text-cyan-200" />;
}

export function MarketsExplorer({
  initialPage,
  source,
}: {
  initialPage: MarketPage;
  source: SportsMarketDiscovery["source"];
}) {
  const firstRender = useRef(true);
  const requestIdRef = useRef(0);
  const [sport, setSport] = useState<(typeof sports)[number] | "All">("All");
  const status: MarketQueryStatus = "all";
  const sort: MarketQuerySort = "liquidity";
  const minVolume = DEFAULT_MARKET_MIN_VOLUME;
  const [rangeStart, setRangeStart] = useState<(typeof rangeOptions)[number]["start"]>(0);
  const [query, setQuery] = useState("");
  const [markets, setMarkets] = useState<TerminalMarket[]>(initialPage.markets);
  const [selectedSearchMarket, setSelectedSearchMarket] = useState<MarketBubbleNode | null>(null);
  const [latestSource, setLatestSource] = useState(source);
  const [isLoading, setIsLoading] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const dashboardLoadStartedAt = useRef(0);
  const initialLoadLoggedRef = useRef(false);
  const closeSelectedMarket = useCallback(() => setSelectedSearchMarket(null), []);
  const activateSport = useCallback((nextSport: (typeof sports)[number]) => {
    setSport(nextSport);
    setRangeStart(0);
    setQuery("");
    setSelectedSearchMarket(null);
  }, []);
  const activateFeaturedCategory = useCallback((nextSport: (typeof sports)[number]) => {
    setSport(nextSport);
    setRangeStart(0);
    setQuery("");
    setSelectedSearchMarket(null);
  }, []);
  const liveRequestUrl = useMemo(
    () => buildMarketsUrl({ offset: 0, limit: maxMarketFetchLimit, sort, sport, status, minVolume }),
    [minVolume, sort, sport, status],
  );

  useEffect(() => {
    if (dashboardLoadStartedAt.current === 0) {
      dashboardLoadStartedAt.current = Date.now();
    }
  }, []);

  useEffect(() => {
    if (markets.length > 0) marketStore.setMarketSnapshots(markets);
  }, [markets]);

  useEffect(() => {
    if (firstRender.current) firstRender.current = false;

    const controller = new AbortController();
    const requestId = ++requestIdRef.current;
    queueMicrotask(() => {
      if (controller.signal.aborted || requestId !== requestIdRef.current) return;
      setIsLoading(true);
      setError(null);
    });
    fetch(liveRequestUrl, { signal: controller.signal })
      .then(readMarketsResponse)
      .then((nextPage) => {
      if (requestId !== requestIdRef.current) return;
      setMarkets(nextPage.markets);
      marketStore.setMarketSnapshots(nextPage.markets, { replace: true });
      setLatestSource(nextPage.source);
      if (process.env.NODE_ENV !== "production" && (process.env.LOGO_DEBUG === "true" || process.env.LOGO_DEBUG === "1")) {
        console.info("[Traak] dashboard market fetch", {
          durationMs: Date.now() - dashboardLoadStartedAt.current,
          sport,
          returned: nextPage.returned,
          total: nextPage.total,
          source: nextPage.source,
        });
      }
    })
      .catch((error) => {
        if ((error as Error).name !== "AbortError") {
          console.error(error);
          if (requestId === requestIdRef.current) setError(error instanceof Error ? error.message : "Unable to load Polymarket sports markets.");
        }
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setIsLoading(false);
      });

    return () => controller.abort();
  }, [liveRequestUrl, refreshNonce, sport]);

  useEffect(() => {
    if (initialLoadLoggedRef.current) return;
    if (isLoading) return;
    if (markets.length === 0) return;
    initialLoadLoggedRef.current = true;
    if (process.env.NODE_ENV !== "production" && (process.env.LOGO_DEBUG === "true" || process.env.LOGO_DEBUG === "1")) {
      console.info("[Traak] dashboard initial render", {
        durationMs: Date.now() - dashboardLoadStartedAt.current,
        marketCount: markets.length,
        source: latestSource,
      });
    }
  }, [isLoading, latestSource, markets.length]);

  const isInitialLoading = isLoading && markets.length === 0;
  const isRefreshing = isLoading && markets.length > 0;
  const selectedRange = rangeOptions.find((option) => option.start === rangeStart) ?? rangeOptions[0];
  const rankedMarkets = useMemo(() => rankHighValueMarkets(markets, minVolume), [markets, minVolume]);
  const visibleMarkets = rankedMarkets.slice(selectedRange.start, selectedRange.end);
  const searchResults = useMemo(() => rankedMarkets.filter((market) => matchesMarketQuery(market, query)).slice(0, 12), [query, rankedMarkets]);
  const categoryCta = sport === "All" ? "Explore markets" : `Explore ${sport}`;

  return (
    <section className="traak-market-section relative w-full overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
      <div className="traak-market-toolbar border-b border-[var(--border)] bg-[var(--surface)] shadow-xl shadow-black/25 backdrop-blur-2xl">
        <div className="mx-auto flex w-full max-w-[118rem] flex-col gap-4 px-5 py-4 sm:px-7 lg:flex-row lg:items-center lg:px-10">
          <div className="flex flex-wrap items-center gap-3">
            {sportPills.map((item) => {
              const active = sport === item.label;
              return (
                <Button
                  aria-label={item.label}
                  className={`h-12 rounded-xl border px-4 text-sm font-bold shadow-lg shadow-black/15 transition duration-200 ${
                    active
                      ? "border-cyan-300/70 bg-cyan-300/12 text-cyan-100 shadow-[0_0_26px_rgba(34,211,238,0.12)] hover:bg-cyan-300/16"
                      : "border-[var(--border)] bg-[var(--surface-3)] text-[var(--foreground)] hover:border-slate-700 hover:bg-[var(--surface-2)]"
                  }`}
                  key={item.label}
                onClick={() => activateSport(item.label)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <SportIcon src={item.icon} fallback={item.fallback} />
                  {item.label}
                </Button>
              );
            })}
            <label className="relative inline-flex h-12 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-3)] px-4 text-sm font-bold text-[var(--foreground)] shadow-lg shadow-black/15 transition hover:border-slate-700 hover:bg-[var(--surface-2)]">
              More
              <ChevronDown className="h-4 w-4 text-[var(--muted)]" />
              <select
                aria-label="Market range"
                className="absolute inset-0 cursor-pointer opacity-0"
                onChange={(event) => {
                  setRangeStart(Number(event.target.value) as typeof rangeStart);
                  setSelectedSearchMarket(null);
                }}
                value={rangeStart}
              >
                {rangeOptions.map((option) => (
                  <option key={option.start} value={option.start}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex flex-1 flex-wrap items-center gap-3 lg:justify-end">
            <label className="relative block flex-1 lg:max-w-md">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
              <Input
                className="h-12 rounded-xl pl-11 text-sm shadow-inner shadow-black/25 transition focus:border-cyan-300/60 placeholder:text-[var(--muted)]"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search markets..."
                value={query}
              />
            </label>
            <Button
              aria-label="Refresh markets"
              className="h-12 rounded-xl border border-[var(--border)] bg-[var(--surface-3)] px-4 text-sm font-semibold text-[var(--foreground)] transition hover:border-slate-700 hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
              disabled={isLoading}
              onClick={() => setRefreshNonce((value) => value + 1)}
              size="sm"
              type="button"
              variant="ghost"
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            {latestSource === "mock" ? <span className="rounded-lg border border-amber-500/40 px-3 py-2 text-xs font-semibold text-amber-600 dark:text-amber-200">Mock</span> : null}
          </div>
        </div>
      </div>

      {error ? (
        <div className="border-b border-rose-500/30 bg-rose-950/50 px-3 py-2 text-sm text-rose-100">{error}</div>
      ) : null}

      {query.trim() ? (
        <div className="traak-search-panel absolute right-5 top-24 z-30 w-[min(92vw,420px)] rounded-xl border border-slate-800 bg-[#090d15]/98 p-3 text-sm text-slate-100 shadow-2xl shadow-black/50 backdrop-blur-2xl lg:top-20">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">Snapshot results</p>
            <span className="text-xs text-zinc-500">{searchResults.length}</span>
          </div>
          <div className="max-h-[52vh] space-y-1 overflow-y-auto">
            {searchResults.length > 0 ? (
              searchResults.map((market, index) => {
                const favoredPrice = Math.round(Math.max(market.yesPrice, market.noPrice) * 100);
                const visuals = getMarketOutcomeVisuals(market);
                return (
                  <button
                    className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-800 bg-black/35 px-3 py-2 text-left transition hover:border-cyan-400/50 hover:bg-cyan-400/10"
                    key={market.id}
                    onClick={() => setSelectedSearchMarket(marketToBubbleNode(market, index))}
                    type="button"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-zinc-100">{market.title}</span>
                      <span className="mt-1 block">
                        <MarketMatchupLogos
                          compact
                          noLabel={visuals.no.displayName}
                          noLogoUrl={visuals.no.logoUrl}
                          yesLabel={visuals.yes.displayName}
                          yesLogoUrl={visuals.yes.logoUrl}
                        />
                      </span>
                      <span className="block text-xs text-zinc-500">
                        {market.league || market.sport} · ${Math.round(market.liquidity).toLocaleString()} liq
                      </span>
                    </span>
                    <span className="shrink-0 text-lg font-black text-white">{favoredPrice}¢</span>
                  </button>
                );
              })
            ) : (
              <div className="rounded border border-zinc-800 bg-black/40 px-3 py-6 text-center text-zinc-500">No snapshot markets match.</div>
            )}
          </div>
        </div>
      ) : null}

      <div className="mx-auto w-full max-w-[118rem] px-5 py-7 sm:px-7 lg:px-10">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="traak-market-heading text-3xl font-bold tracking-tight text-[var(--foreground)] sm:text-4xl">Live Markets</h1>
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-600 dark:text-emerald-300">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-300 shadow-[0_0_14px_rgba(52,211,153,0.9)]" />
              Live
            </span>
          </div>
          <Button
            className="h-11 rounded-xl border border-[var(--border)] bg-[var(--surface-3)] px-4 text-sm font-semibold text-[var(--foreground)] shadow-lg shadow-black/15 transition hover:border-cyan-400/35 hover:bg-cyan-400/8"
            onClick={() => {
              setRangeStart(0);
              setQuery("");
            }}
            type="button"
            variant="ghost"
          >
            {categoryCta}
          </Button>
        </div>

        {isRefreshing ? (
          <div className="mb-4 inline-flex items-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-400/8 px-4 py-2 text-sm font-semibold text-cyan-700 dark:text-cyan-100">
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            Refreshing {sport === "All" ? "markets" : `${sport} markets`}
          </div>
        ) : null}

        <div className="traak-market-stage-shell rounded-[1.75rem] border border-[var(--border)] bg-[var(--surface)] p-3 shadow-[0_24px_90px_rgba(15,23,42,0.12)]">
          <MarketBubbleMap activeSport={sport} isLoading={isInitialLoading} isRefreshing={isRefreshing} markets={visibleMarkets} />
        </div>

        <div className="traak-collection-panel mt-5 rounded-2xl border border-slate-800/90 bg-slate-900/58 p-4 shadow-xl shadow-black/25 backdrop-blur-xl">
          <div className="mb-4 flex items-end justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.2em] text-[var(--muted)]">Trending Now</p>
              <h2 className="mt-1 text-lg font-semibold text-[var(--foreground)]">Popular market collections</h2>
            </div>
            <p className="hidden text-sm text-[var(--muted)] sm:block">Tap a card to switch the board.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {featuredCategories.map((item) => {
              const active = sport === item.sport;
              return (
                <button
                  aria-pressed={active}
                  className={`traak-collection-card group flex min-h-[96px] items-center justify-between gap-3 rounded-xl border p-4 text-left transition duration-200 ${
                    active
                      ? "border-cyan-300/60 bg-cyan-300/10 shadow-[0_0_24px_rgba(34,211,238,0.10),inset_0_1px_0_rgba(255,255,255,0.04)]"
                      : "border-[var(--border)] bg-[var(--surface-3)] hover:-translate-y-0.5 hover:border-cyan-400/35 hover:bg-cyan-400/8 hover:shadow-lg hover:shadow-black/20"
                  }`}
                  key={item.title}
                  onClick={() => {
                    activateFeaturedCategory(item.sport);
                  }}
                  type="button"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <SportIcon src={item.icon} fallback={item.fallback} className="h-9 w-9" />
                    <div className="min-w-0">
                      <span className="block truncate font-bold text-[var(--foreground)]">{item.title}</span>
                      <span className="mt-1 block text-sm text-[var(--muted)]">{item.detail}</span>
                    </div>
                  </div>
                  <span
                    className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border transition ${
                      active
                        ? "border-cyan-300/30 bg-cyan-300/14 text-cyan-100"
                        : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] group-hover:border-cyan-300/30 group-hover:text-cyan-100"
                    }`}
                  >
                    <ArrowRight className="h-4 w-4" />
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {selectedSearchMarket ? (
        <MarketTradePanel
          key={selectedSearchMarket.id}
          market={selectedSearchMarket}
          onClose={closeSelectedMarket}
          onUpdatePrices={fetchLatestMarketForNode}
          presentation="modal"
        />
      ) : null}
    </section>
  );
}
