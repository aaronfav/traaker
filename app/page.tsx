import { MarketsExplorer } from "@/components/MarketsExplorer";
import { MetricCard } from "@/components/MetricCard";
import { createEmptyMarketCounts, createEmptyMarketPage, DEFAULT_MARKET_MIN_VOLUME, getCachedMarketCountsState } from "@/lib/polymarket/markets";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const countsState = getCachedMarketCountsState(DEFAULT_MARKET_MIN_VOLUME);
  const counts = countsState.loading ? createEmptyMarketCounts() : countsState.counts;
  const initialPage = createEmptyMarketPage();

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <section className="mb-8">
        <p className="text-sm uppercase tracking-[0.24em] text-cyan-200/80">Polymarket Sports</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-50">Trading terminal</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">
          Browse high-quality sports markets ranked by liquidity, volume, price movement, and recent activity.
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        <MetricCard
          badge={countsState.loading ? "Calculating" : undefined}
          detail={countsState.loading ? "Waiting for cached counts" : `${counts.totalEligibleSportsMarkets} eligible sports`}
          label="$2K+ Markets"
          value={countsState.loading ? "..." : String(counts.marketsWithMinVolume)}
        />
        <MetricCard label="Live" value={countsState.loading ? "..." : String(counts.liveWithMinVolume)} />
        <MetricCard label="Upcoming" value={countsState.loading ? "..." : String(counts.upcomingWithMinVolume)} />
        <MetricCard label="Stale Excluded" value={countsState.loading ? "..." : String(counts.staleExcluded)} detail="Dev filter only" />
      </section>

      <MarketsExplorer
        counts={counts}
        countsLoading={countsState.loading}
        includeDebugFilters={process.env.NODE_ENV !== "production"}
        initialPage={initialPage}
        source="polymarket"
      />
    </main>
  );
}
