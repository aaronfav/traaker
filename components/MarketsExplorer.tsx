"use client";

import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { MarketRows } from "@/components/MarketRows";
import type { MarketCountsApiResponse, MarketPage, MarketQuerySort, MarketQueryStatus, SportsMarketDiscovery } from "@/lib/polymarket/markets";
import type { TerminalMarket } from "@/lib/polymarket/types";

const sports = ["All", "NBA", "NFL", "Soccer", "UFC", "Tennis"] as const;
const statuses = ["all", "live", "upcoming"] as const;
const staleStatus = "stale" as const;
const minVolumeOptions = [
  { label: "$0+", value: 0 },
  { label: "$1K+", value: 1000 },
  { label: "$2K+", value: 2000 },
  { label: "$5K+", value: 5000 },
  { label: "$10K+", value: 10000 },
  { label: "$50K+", value: 50000 },
] as const;
const sortOptions: { label: string; value: MarketQuerySort }[] = [
  { label: "Opportunity", value: "opportunity" },
  { label: "Volume", value: "volume" },
  { label: "Liquidity", value: "liquidity" },
  { label: "Movement", value: "movement" },
  { label: "Spread", value: "spread" },
];
const PAGE_LIMIT = 100;

type MarketsResponse = MarketPage & {
  counts: SportsMarketDiscovery["counts"];
  countsLoading?: boolean;
  source: SportsMarketDiscovery["source"];
};

function buildMarketsUrl(params: {
  offset: number;
  search: string;
  sort: MarketQuerySort;
  sport: string;
  status: MarketQueryStatus;
  minVolume: number;
}) {
  const searchParams = new URLSearchParams({
    limit: String(PAGE_LIMIT),
    offset: String(params.offset),
    minVolume: String(params.minVolume),
    sort: params.sort,
    status: params.status,
  });
  if (params.sport !== "All") searchParams.set("sport", params.sport);
  if (params.search.trim()) searchParams.set("search", params.search.trim());
  return `/api/polymarket/markets?${searchParams.toString()}`;
}

export function MarketsExplorer({
  counts,
  countsLoading = false,
  includeDebugFilters = false,
  initialPage,
  source,
}: {
  counts: SportsMarketDiscovery["counts"];
  countsLoading?: boolean;
  includeDebugFilters?: boolean;
  initialPage: MarketPage;
  source: SportsMarketDiscovery["source"];
}) {
  const firstRender = useRef(true);
  const requestIdRef = useRef(0);
  const [sport, setSport] = useState<(typeof sports)[number]>("All");
  const [status, setStatus] = useState<MarketQueryStatus>("all");
  const [sort, setSort] = useState<MarketQuerySort>("opportunity");
  const [minVolume, setMinVolume] = useState(2000);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [markets, setMarkets] = useState<TerminalMarket[]>(initialPage.markets);
  const [page, setPage] = useState(initialPage);
  const [latestCounts, setLatestCounts] = useState(counts);
  const [latestSource, setLatestSource] = useState(source);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isCountsLoading, setIsCountsLoading] = useState(countsLoading);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;
    const controller = new AbortController();

    const loadCounts = async () => {
      try {
        const response = await fetch(`/api/polymarket/markets/counts?minVolume=${minVolume}`, { signal: controller.signal });
        if (!response.ok) throw new Error("Unable to load market counts");
        const payload = (await response.json()) as MarketCountsApiResponse;
        if (cancelled) return;
        if (payload.loading) {
          setIsCountsLoading(true);
          retryTimer = window.setTimeout(loadCounts, 1000);
          return;
        }
        setLatestCounts(payload.counts);
        setLatestSource(payload.source);
        setIsCountsLoading(false);
      } catch (error) {
        if ((error as Error).name !== "AbortError") console.error(error);
      }
    };

    setIsCountsLoading(countsLoading);
    void loadCounts();

    return () => {
      cancelled = true;
      controller.abort();
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [countsLoading, minVolume]);

  useEffect(() => {
    const schedule = () => {
      const prewarmUrl = new URL("/api/polymarket/markets/prewarm", window.location.origin).toString();
      void fetch(prewarmUrl).catch((error) => console.error(error));
    };

    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
      cancelIdleCallback?: (handle: number) => void;
    };

    if (idleWindow.requestIdleCallback) {
      const handle = idleWindow.requestIdleCallback(schedule, { timeout: 2000 });
      return () => idleWindow.cancelIdleCallback?.(handle);
    }

    const timer = window.setTimeout(schedule, 1500);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (firstRender.current) firstRender.current = false;

    const controller = new AbortController();
    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    fetch(buildMarketsUrl({ offset: 0, search: debouncedQuery, sort, sport, status, minVolume }), { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load markets");
        return (await response.json()) as MarketsResponse;
      })
      .then((nextPage) => {
        if (requestId !== requestIdRef.current) return;
        setMarkets(nextPage.markets);
        setPage(nextPage);
        setLatestCounts(nextPage.counts);
        setLatestSource(nextPage.source);
        setIsCountsLoading(nextPage.countsLoading ?? false);
      })
      .catch((error) => {
        if ((error as Error).name !== "AbortError") console.error(error);
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setIsLoading(false);
      });

    return () => controller.abort();
  }, [debouncedQuery, minVolume, sort, sport, status]);

  const loadMore = async () => {
    setIsLoadingMore(true);
    try {
      const response = await fetch(buildMarketsUrl({ offset: markets.length, search: debouncedQuery, sort, sport, status, minVolume }));
      if (!response.ok) throw new Error("Unable to load more markets");
      const nextPage = (await response.json()) as MarketsResponse;
      setMarkets((current) => [...current, ...nextPage.markets]);
      setPage(nextPage);
      setLatestCounts(nextPage.counts);
      setLatestSource(nextPage.source);
      setIsCountsLoading(nextPage.countsLoading ?? false);
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoadingMore(false);
    }
  };

  const statusOptions: MarketQueryStatus[] = includeDebugFilters ? [...statuses, staleStatus] : [...statuses];
  const isInitialLoading = isLoading && markets.length === 0;
  const isRefreshing = isLoading && markets.length > 0;
  const selectedMinVolumeLabel = minVolumeOptions.find((option) => option.value === minVolume)?.label ?? "$2K+";

  return (
    <section className="mt-8 space-y-4">
      <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <Input className="pl-9" onChange={(event) => setQuery(event.target.value)} placeholder="Search teams, leagues, outcomes" value={query} />
        </label>
        <div className="flex flex-wrap gap-2">
          {sports.map((item) => (
            <Button key={item} onClick={() => setSport(item)} size="sm" type="button" variant={sport === item ? "default" : "secondary"}>
              {item}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {statusOptions.map((item) => (
          <Button key={item} onClick={() => setStatus(item)} size="sm" type="button" variant={status === item ? "outline" : "ghost"}>
            {item === "all" ? "Live + upcoming" : item === "stale" ? "Stale/unknown" : item}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {sortOptions.map((item) => (
          <Button key={item.value} onClick={() => setSort(item.value)} size="sm" type="button" variant={sort === item.value ? "outline" : "ghost"}>
            {item.label}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs uppercase tracking-[0.18em] text-slate-500">Minimum volume</label>
        <select
          className="h-9 rounded-md border border-slate-700 bg-slate-950 px-3 text-sm text-slate-200"
          onChange={(event) => setMinVolume(Number(event.target.value))}
          value={minVolume}
        >
          {minVolumeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-400">
        <p>
          {isCountsLoading ? (
            <>
              Showing {markets.length} markets with {selectedMinVolumeLabel} volume.
            </>
          ) : (
            <>
              Showing {markets.length} of {page.total} markets with {selectedMinVolumeLabel} volume.
            </>
          )}{" "}
          {latestCounts.staleExcluded} stale/unknown excluded from the default view.
        </p>
        <div className="flex items-center gap-2">
          {isCountsLoading ? <span className="text-xs text-cyan-200">Calculating</span> : null}
          {isRefreshing ? <span className="text-xs text-cyan-200">Refreshing</span> : null}
          {latestSource === "mock" ? <span className="rounded-full border border-amber-500/40 px-2 py-0.5 text-xs text-amber-200">Mock fallback</span> : null}
        </div>
      </div>

      {isInitialLoading ? (
        <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-8 text-center text-sm text-slate-400">Loading markets...</div>
      ) : (
        <MarketRows markets={markets} />
      )}

      {page.hasMore && !isLoading ? (
        <div className="flex justify-center">
          <Button disabled={isLoadingMore} onClick={loadMore} type="button" variant="secondary">
            {isLoadingMore ? "Loading..." : "Load more"}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
