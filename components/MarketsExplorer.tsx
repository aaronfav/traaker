"use client";

import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { MarketRows } from "@/components/MarketRows";
import type { MarketPage, MarketQuerySort, MarketQueryStatus, SportsMarketDiscovery } from "@/lib/polymarket/markets";
import type { TerminalMarket } from "@/lib/polymarket/types";

const sports = ["All", "NBA", "NFL", "Soccer", "UFC", "Tennis"] as const;
const statuses = ["all", "live", "upcoming"] as const;
const staleStatus = "stale" as const;
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
  source: SportsMarketDiscovery["source"];
};

function buildMarketsUrl(params: {
  offset: number;
  search: string;
  sort: MarketQuerySort;
  sport: string;
  status: MarketQueryStatus;
}) {
  const searchParams = new URLSearchParams({
    limit: String(PAGE_LIMIT),
    offset: String(params.offset),
    sort: params.sort,
    status: params.status,
  });
  if (params.sport !== "All") searchParams.set("sport", params.sport);
  if (params.search.trim()) searchParams.set("search", params.search.trim());
  return `/api/polymarket/markets?${searchParams.toString()}`;
}

export function MarketsExplorer({
  counts,
  includeDebugFilters = false,
  initialPage,
  source,
}: {
  counts: SportsMarketDiscovery["counts"];
  includeDebugFilters?: boolean;
  initialPage: MarketPage;
  source: SportsMarketDiscovery["source"];
}) {
  const firstRender = useRef(true);
  const [sport, setSport] = useState<(typeof sports)[number]>("All");
  const [status, setStatus] = useState<MarketQueryStatus>("all");
  const [sort, setSort] = useState<MarketQuerySort>("opportunity");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [markets, setMarkets] = useState<TerminalMarket[]>(initialPage.markets);
  const [page, setPage] = useState(initialPage);
  const [latestCounts, setLatestCounts] = useState(counts);
  const [latestSource, setLatestSource] = useState(source);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 350);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (firstRender.current) firstRender.current = false;

    const controller = new AbortController();
    setIsLoading(true);
    fetch(buildMarketsUrl({ offset: 0, search: debouncedQuery, sort, sport, status }), { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load markets");
        return (await response.json()) as MarketsResponse;
      })
      .then((nextPage) => {
        setMarkets(nextPage.markets);
        setPage(nextPage);
        setLatestCounts(nextPage.counts);
        setLatestSource(nextPage.source);
      })
      .catch((error) => {
        if ((error as Error).name !== "AbortError") console.error(error);
      })
      .finally(() => setIsLoading(false));

    return () => controller.abort();
  }, [debouncedQuery, sort, sport, status]);

  const loadMore = async () => {
    setIsLoadingMore(true);
    try {
      const response = await fetch(buildMarketsUrl({ offset: markets.length, search: debouncedQuery, sort, sport, status }));
      if (!response.ok) throw new Error("Unable to load more markets");
      const nextPage = (await response.json()) as MarketsResponse;
      setMarkets((current) => [...current, ...nextPage.markets]);
      setPage(nextPage);
      setLatestCounts(nextPage.counts);
      setLatestSource(nextPage.source);
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoadingMore(false);
    }
  };

  const statusOptions: MarketQueryStatus[] = includeDebugFilters ? [...statuses, staleStatus] : [...statuses];

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

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-400">
        <p>
          Showing {markets.length} of {page.total} matching markets. {latestCounts.staleOrUnknownSportsMarkets} stale/unknown excluded from the default view.
        </p>
        {latestSource === "mock" ? <span className="rounded-full border border-amber-500/40 px-2 py-0.5 text-xs text-amber-200">Mock fallback</span> : null}
      </div>

      {isLoading ? (
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
