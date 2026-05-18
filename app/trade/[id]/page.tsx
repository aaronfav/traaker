import { MarketChart } from "@/components/MarketChart";
import { MetricCard } from "@/components/MetricCard";
import { TradeTicket } from "@/components/TradeTicket";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchMarketChart, getMarketById } from "@/lib/polymarket/markets";
import { isRealTradingEnabled } from "@/lib/server/tradingConfig";

export const dynamic = "force-dynamic";

export default async function TradePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ outcome?: string }>;
}) {
  const { id } = await params;
  const { outcome } = await searchParams;
  const market = await getMarketById(id);
  const chart = await fetchMarketChart(market.tokenIds.yes, market.yesPrice);

  return (
    <main className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[1fr_420px] lg:px-8">
      <section className="space-y-6">
        <div>
          <p className="text-sm uppercase tracking-[0.24em] text-cyan-200/80">{market.league}</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-50">{market.title}</h1>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <MetricCard label="YES" value={`${(market.yesPrice * 100).toFixed(1)}c`} detail={market.outcomes.yes} />
          <MetricCard label="NO" value={`${(market.noPrice * 100).toFixed(1)}c`} detail={market.outcomes.no} />
          <MetricCard label="Opportunity" value={`${market.opportunityScore}/100`} />
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Price context</CardTitle>
          </CardHeader>
          <CardContent>
            <MarketChart data={chart} />
          </CardContent>
        </Card>
      </section>

      <TradeTicket initialOutcome={outcome === "no" ? "no" : "yes"} market={market} realTradingEnabled={isRealTradingEnabled()} />
    </main>
  );
}
