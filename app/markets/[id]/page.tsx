import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MarketChart } from "@/components/MarketChart";
import { MetricCard } from "@/components/MetricCard";
import { OrderbookDepth } from "@/components/OrderbookDepth";
import { liquidityScore, momentumScore, opportunityExplanation, spreadScore, volatilityScore, volumeSpikeIndicator } from "@/lib/analytics/scoring";
import { fetchMarketChart, fetchOrderbook, fetchRecentTrades, getMarketById } from "@/lib/polymarket/markets";

export const dynamic = "force-dynamic";

export default async function MarketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const market = await getMarketById(id);
  const [chart, orderbook, trades] = await Promise.all([
    fetchMarketChart(market.tokenIds.yes, market.yesPrice),
    fetchOrderbook(market.tokenIds.yes),
    fetchRecentTrades(market.conditionId),
  ]);
  const bestBid = orderbook.bids[0]?.price ?? 0;
  const bestAsk = orderbook.asks[0]?.price ?? 0;
  const depth = [...orderbook.bids, ...orderbook.asks].reduce((sum, level) => sum + level.size, 0);
  const firstChartPrice = chart[0]?.yes ?? market.yesPrice;
  const oneHourPoint = chart[Math.max(0, chart.length - 3)]?.yes ?? firstChartPrice;
  const latestChartPrice = chart[chart.length - 1]?.yes ?? market.yesPrice;
  const move1h = latestChartPrice - oneHourPoint;
  const moveChart = latestChartPrice - firstChartPrice;

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap gap-2">
            <Badge tone={market.status === "live" ? "green" : "cyan"}>{market.status}</Badge>
            <Badge tone="slate">{market.league}</Badge>
            <Badge tone="amber">Opportunity {market.opportunityScore}</Badge>
          </div>
          <h1 className="mt-3 max-w-4xl text-3xl font-semibold tracking-tight text-slate-50">{market.title}</h1>
          <p className="mt-2 text-sm text-slate-400">
            {market.outcomes.yes} YES / {market.outcomes.no} NO
          </p>
        </div>
        <div className="flex gap-2">
          <Button>
            <Link className="inline-flex items-center gap-2" href={`/trade/${market.id}?outcome=yes`}>
              Trade YES <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button variant="secondary">
            <Link className="inline-flex items-center gap-2" href={`/trade/${market.id}?outcome=no`}>
              Trade NO
            </Link>
          </Button>
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">YES</p>
                <h2 className="mt-2 text-xl font-semibold text-slate-50">{market.outcomes.yes}</h2>
                <p className="mt-1 text-sm text-slate-400">{(market.yesPrice * 100).toFixed(1)}% implied probability</p>
              </div>
              <p className="text-3xl font-semibold text-emerald-300">{(market.yesPrice * 100).toFixed(1)}c</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">NO</p>
                <h2 className="mt-2 text-xl font-semibold text-slate-50">{market.outcomes.no}</h2>
                <p className="mt-1 text-sm text-slate-400">{(market.noPrice * 100).toFixed(1)}% implied probability</p>
              </div>
              <p className="text-3xl font-semibold text-rose-300">{(market.noPrice * 100).toFixed(1)}c</p>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="mt-4 grid gap-4 md:grid-cols-4">
        <MetricCard label="Best bid / ask" value={`${(bestBid * 100).toFixed(1)}c / ${(bestAsk * 100).toFixed(1)}c`} detail={`Spread ${(market.spread * 100).toFixed(2)}c`} />
        <MetricCard label="Liquidity depth" value={depth.toLocaleString()} detail="Top visible levels" />
        <MetricCard label="Volume" value={new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact" }).format(market.volume24h)} detail="24h" />
        <MetricCard label="Liquidity" value={new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact" }).format(market.liquidity)} />
      </section>

      <section className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader>
            <CardTitle>YES price chart</CardTitle>
          </CardHeader>
          <CardContent>
            <MarketChart data={chart} />
            <div className="mt-4 grid gap-3 text-sm md:grid-cols-3">
              <div className="rounded-md border border-slate-800 p-3">
                <p className="text-slate-500">1h move</p>
                <p className={move1h >= 0 ? "font-medium text-emerald-300" : "font-medium text-rose-300"}>{(move1h * 100).toFixed(2)}c</p>
              </div>
              <div className="rounded-md border border-slate-800 p-3">
                <p className="text-slate-500">24h move</p>
                <p className={market.priceMove24h >= 0 ? "font-medium text-emerald-300" : "font-medium text-rose-300"}>{(market.priceMove24h * 100).toFixed(2)}c</p>
              </div>
              <div className="rounded-md border border-slate-800 p-3">
                <p className="text-slate-500">Chart window</p>
                <p className={moveChart >= 0 ? "font-medium text-emerald-300" : "font-medium text-rose-300"}>{(moveChart * 100).toFixed(2)}c</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4">
          <MetricCard label="Momentum score" value={`${momentumScore(market.priceMove24h, market.recentTradesCount)}/100`} />
          <MetricCard label="Volatility score" value={`${volatilityScore(market.priceMove24h)}/100`} detail={`${(market.priceMove24h * 100).toFixed(1)}% 24h`} />
        <div title={opportunityExplanation({
          liquidity: market.liquidity,
          volume: market.volume24h,
          priceMove24h: market.priceMove24h,
          recentTrades: market.recentTradesCount,
          spread: market.spread,
          volumeAcceleration: market.volumeAcceleration,
        })}>
          <MetricCard label="Opportunity score" value={`${market.opportunityScore}/100`} detail="Hover for factors" />
        </div>
        <MetricCard label="Liquidity score" value={`${liquidityScore(market.liquidity)}/100`} />
        <MetricCard label="Spread score" value={`${spreadScore(market.spread)}/100`} detail={`${(market.spread * 100).toFixed(2)}c spread`} />
        <MetricCard label="Volume acceleration" value={`${market.volumeAcceleration.toFixed(2)}x`} detail={volumeSpikeIndicator(market.volume24h, market.volume1wk / 7)} />
      </div>
      </section>

      <section className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Orderbook depth</CardTitle>
          </CardHeader>
          <CardContent>
            <OrderbookDepth orderbook={orderbook} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent trades</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {trades.map((trade) => (
                <div className="grid grid-cols-4 rounded-md border border-slate-800 px-3 py-2 text-sm" key={trade.id}>
                  <span className={trade.side === "BUY" ? "text-emerald-300" : "text-rose-300"}>{trade.side}</span>
                  <span>{trade.outcome}</span>
                  <span className="text-right">{(trade.price * 100).toFixed(1)}c</span>
                  <span className="text-right text-slate-400">{trade.size.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
