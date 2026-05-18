import { MarketsExplorer } from "@/components/MarketsExplorer";
import { MetricCard } from "@/components/MetricCard";
import { createEmptyMarketPage, getCachedMarketCountsSnapshot } from "@/lib/polymarket/markets";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const counts = getCachedMarketCountsSnapshot();
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
          detail={counts.tradableSportsMarkets ? `${counts.tradableSportsMarkets} tradable sports` : "Loading counts"}
          label="Eligible Markets"
          value={counts.displayedMarkets ? String(counts.displayedMarkets) : "..."}
        />
        <MetricCard label="Live" value={counts.liveSportsMarkets ? String(counts.liveSportsMarkets) : "..."} />
        <MetricCard label="Upcoming" value={counts.upcomingSportsMarkets ? String(counts.upcomingSportsMarkets) : "..."} />
        <MetricCard label="Stale Excluded" value={counts.staleOrUnknownSportsMarkets ? String(counts.staleOrUnknownSportsMarkets) : "..."} detail="Dev filter only" />
      </section>

      <MarketsExplorer counts={counts} includeDebugFilters={process.env.NODE_ENV !== "production"} initialPage={initialPage} source="polymarket" />
    </main>
  );
}
