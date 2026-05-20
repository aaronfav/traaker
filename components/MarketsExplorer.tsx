"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, Search, Settings } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { fetchLatestMarketForNode, MarketBubbleMap, marketToBubbleNode, type MarketBubbleNode } from "@/components/MarketBubbleMap";
import { MarketTradePanel } from "@/components/MarketTradePanel";
import { marketStore } from "@/app/store/marketStore";
import { DEFAULT_MARKET_MIN_VOLUME, hasUsefulFavoredPrice, rankHighValueMarkets } from "@/lib/polymarket/marketDisplay";
import type { MarketPage, MarketQuerySort, MarketQueryStatus, SportsMarketDiscovery } from "@/lib/polymarket/markets";
import type { TerminalMarket } from "@/lib/polymarket/types";

const sports = ["All", "NBA", "NFL", "Soccer", "UFC", "Tennis"] as const;
const timeframes = ["1H", "1D", "1W", "1M"] as const;
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

export function MarketsExplorer({
  initialPage,
  source,
}: {
  initialPage: MarketPage;
  source: SportsMarketDiscovery["source"];
}) {
  const firstRender = useRef(true);
  const requestIdRef = useRef(0);
  const [sport, setSport] = useState<(typeof sports)[number]>("All");
  const status: MarketQueryStatus = "all";
  const sort: MarketQuerySort = "liquidity";
  const minVolume = DEFAULT_MARKET_MIN_VOLUME;
  const [timeframe, setTimeframe] = useState<(typeof timeframes)[number]>("1D");
  const [rangeStart, setRangeStart] = useState<(typeof rangeOptions)[number]["start"]>(0);
  const [query, setQuery] = useState("");
  const [markets, setMarkets] = useState<TerminalMarket[]>(initialPage.markets);
  const [selectedSearchMarket, setSelectedSearchMarket] = useState<MarketBubbleNode | null>(null);
  const [latestSource, setLatestSource] = useState(source);
  const [isLoading, setIsLoading] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const liveRequestUrl = useMemo(
    () => buildMarketsUrl({ offset: 0, limit: maxMarketFetchLimit, sort, sport, status, minVolume }),
    [minVolume, sort, sport, status],
  );

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
  }, [liveRequestUrl, refreshNonce]);

  const isInitialLoading = isLoading && markets.length === 0;
  const isRefreshing = isLoading && markets.length > 0;
  const selectedRange = rangeOptions.find((option) => option.start === rangeStart) ?? rangeOptions[0];
  const rankedMarkets = useMemo(() => rankHighValueMarkets(markets, minVolume), [markets, minVolume]);
  const visibleMarkets = rankedMarkets.slice(selectedRange.start, selectedRange.end);
  const searchResults = useMemo(() => rankedMarkets.filter((market) => matchesMarketQuery(market, query)).slice(0, 12), [query, rankedMarkets]);

  return (
    <section className="relative w-screen bg-[#050505]">
      <div className="flex min-h-9 flex-wrap items-center gap-1 border-b border-zinc-800 bg-[#111113] px-2 py-1 text-sm shadow-lg shadow-black/30">
        <div className="mr-2 flex items-center gap-2 px-1">
          <span className="h-3 w-3 rounded-full bg-cyan-400 shadow-[0_0_18px_rgba(34,211,238,0.8)]" />
          <span className="font-semibold tracking-wide text-zinc-100">Traak</span>
        </div>
        <div className="flex rounded-md border border-zinc-800 bg-black p-0.5">
          {timeframes.map((item) => (
            <button
              className={`h-6 rounded px-2 text-xs font-semibold transition ${timeframe === item ? "bg-zinc-100 text-black" : "text-zinc-400 hover:text-zinc-100"}`}
              key={item}
              onClick={() => setTimeframe(item)}
              type="button"
            >
              {item}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {sports.map((item) => (
            <Button className="h-6 px-2 text-xs" key={item} onClick={() => setSport(item)} size="sm" type="button" variant={sport === item ? "default" : "ghost"}>
              {item}
            </Button>
          ))}
        </div>
        <select
          aria-label="Market range"
          className="h-6 rounded-md border border-zinc-800 bg-black px-2 text-xs font-semibold text-zinc-100"
          onChange={(event) => setRangeStart(Number(event.target.value) as typeof rangeStart)}
          value={rangeStart}
        >
          {rangeOptions.map((option) => (
            <option key={option.start} value={option.start}>
              {option.label}
            </option>
          ))}
        </select>
        <label className="relative ml-auto block">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          <Input
            className="h-6 w-[min(52vw,280px)] border-zinc-800 bg-black pl-8 text-xs"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search snapshot..."
            value={query}
          />
        </label>
        <span
          className="rounded-full border border-cyan-400/40 px-2 py-0.5 text-xs font-semibold text-cyan-200"
          title="Prices are frozen for trading stability. Press Refresh to update."
        >
          Snapshot
        </span>
        <Button
          aria-label="Refresh markets"
          className="h-6 gap-1 px-2 text-xs"
          disabled={isLoading}
          onClick={() => setRefreshNonce((value) => value + 1)}
          size="sm"
          type="button"
          variant="ghost"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
        {latestSource === "mock" ? <span className="rounded-full border border-amber-500/40 px-2 py-0.5 text-xs text-amber-200">Mock</span> : null}
        <Button aria-label="Settings" className="h-6 w-6" size="icon" type="button" variant="ghost">
          <Settings className="h-4 w-4" />
        </Button>
      </div>

      {error ? (
        <div className="border-b border-rose-500/30 bg-rose-950/50 px-3 py-2 text-sm text-rose-100">{error}</div>
      ) : null}

      {query.trim() ? (
        <div className="absolute right-3 top-11 z-30 w-[min(92vw,420px)] rounded-md border border-zinc-800 bg-[#090a0d]/98 p-3 text-sm text-zinc-100 shadow-2xl shadow-black/50 backdrop-blur">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">Snapshot results</p>
            <span className="text-xs text-zinc-500">{searchResults.length}</span>
          </div>
          <div className="max-h-[52vh] space-y-1 overflow-y-auto">
            {searchResults.length > 0 ? (
              searchResults.map((market, index) => {
                const favoredPrice = Math.round(Math.max(market.yesPrice, market.noPrice) * 100);
                return (
                  <button
                    className="flex w-full items-center justify-between gap-3 rounded border border-zinc-800 bg-black/40 px-3 py-2 text-left transition hover:border-cyan-400/50 hover:bg-cyan-400/10"
                    key={market.id}
                    onClick={() => setSelectedSearchMarket(marketToBubbleNode(market, index))}
                    type="button"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-zinc-100">{market.title}</span>
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

      <MarketBubbleMap isLoading={isInitialLoading} isRefreshing={isRefreshing} markets={visibleMarkets} />

      {selectedSearchMarket ? (
        <div className="fixed inset-0 z-40 bg-black/10" onClick={() => setSelectedSearchMarket(null)}>
          <MarketTradePanel key={selectedSearchMarket.id} market={selectedSearchMarket} onClose={() => setSelectedSearchMarket(null)} onUpdatePrices={fetchLatestMarketForNode} />
        </div>
      ) : null}
    </section>
  );
}
