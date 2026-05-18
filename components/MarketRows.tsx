import Link from "next/link";
import { ArrowRight, Activity } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { opportunityExplanation } from "@/lib/analytics/scoring";
import type { TerminalMarket } from "@/lib/polymarket/types";

const money = (value: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact" }).format(value);
const pct = (value: number) => `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
const startTime = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "short", timeStyle: "short" }).format(parsed);
};

export function MarketRows({ markets }: { markets: TerminalMarket[] }) {
  if (markets.length === 0) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-8 text-center text-sm text-slate-400">
        No sports markets matched this view.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-800">
      <div className="hidden grid-cols-[minmax(280px,1fr)_110px_130px_100px_110px_110px_100px_90px] gap-4 border-b border-slate-800 bg-slate-900/70 px-4 py-3 text-xs uppercase tracking-[0.16em] text-slate-500 xl:grid">
        <span>Market</span>
        <span>Sport</span>
        <span>Start</span>
        <span>YES</span>
        <span>Volume</span>
        <span>Liquidity</span>
        <span>Move</span>
        <span>Score</span>
      </div>
      <div className="divide-y divide-slate-800">
        {markets.map((market) => (
          <div
            className="grid gap-4 bg-slate-950/70 p-4 transition hover:bg-slate-900/60 xl:grid-cols-[minmax(280px,1fr)_110px_130px_100px_110px_110px_100px_90px] xl:items-center"
            key={market.id}
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={market.status === "live" ? "green" : market.status === "stale" ? "slate" : "cyan"}>
                  <Activity className="h-3 w-3" />
                  {market.status}
                </Badge>
                <Badge tone="slate">{market.league}</Badge>
              </div>
              <Link className="mt-2 block text-base font-semibold text-slate-50 hover:text-cyan-200" href={`/markets/${market.id}`}>
                {market.title}
              </Link>
              <p className="mt-1 text-sm text-slate-500">
                {market.outcomes.yes} vs {market.outcomes.no}
              </p>
            </div>
            <div>
              <p className="text-sm text-slate-500 xl:hidden">Sport</p>
              <p className="font-medium text-slate-200">{market.sport}</p>
            </div>
            <div>
              <p className="text-sm text-slate-500 xl:hidden">Start</p>
              <p className="text-sm font-medium text-slate-200">{startTime(market.startTime)}</p>
            </div>
            <div>
              <p className="text-sm text-slate-500 xl:hidden">YES</p>
              <p className="text-lg font-semibold text-slate-50">{(market.yesPrice * 100).toFixed(1)}c</p>
              <p className="text-xs text-slate-500">NO {(market.noPrice * 100).toFixed(1)}c</p>
            </div>
            <div>
              <p className="text-sm text-slate-500 xl:hidden">Volume</p>
              <p className="font-medium text-slate-200">{money(market.volume24h)}</p>
            </div>
            <div>
              <p className="text-sm text-slate-500 xl:hidden">Liquidity</p>
              <p className="font-medium text-slate-200">{money(market.liquidity)}</p>
            </div>
            <div>
              <p className="text-sm text-slate-500 xl:hidden">24h move</p>
              <p className={market.priceMove24h >= 0 ? "font-medium text-emerald-300" : "font-medium text-rose-300"}>
                {pct(market.priceMove24h)}
              </p>
            </div>
            <Link
              className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-amber-400/30 bg-amber-400/10 px-3 text-xs font-medium text-amber-200 transition hover:bg-amber-400/15"
              href={`/markets/${market.id}`}
              title={opportunityExplanation({
                liquidity: market.liquidity,
                volume: market.volume24h,
                priceMove24h: market.priceMove24h,
                recentTrades: market.recentTradesCount,
                spread: market.spread,
                volumeAcceleration: market.volumeAcceleration,
              })}
            >
              {market.opportunityScore}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
