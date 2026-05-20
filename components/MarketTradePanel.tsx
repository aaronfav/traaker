"use client";

import { useState } from "react";
import { ExternalLink, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TradeTicket } from "@/components/trading/TradeTicket";
import type { MarketBubbleNode } from "@/components/MarketBubbleMap";

const money = (value: number) => {
  const numeric = Number.isFinite(value) ? Math.max(0, value) : 0;
  if (numeric >= 1_000_000) return `$${(numeric / 1_000_000).toFixed(1)}M`;
  if (numeric >= 1_000) return `$${(numeric / 1_000).toFixed(numeric >= 100_000 ? 0 : 1)}k`;
  return `$${Math.round(numeric)}`;
};

const formatCents = (price: number) => `${Math.round(Math.max(0, Math.min(1, Number.isFinite(price) ? price : 0)) * 100)}\u00a2`;
const formatMovement = (value: number) => `${value >= 0 ? "+" : ""}${(Number.isFinite(value) ? value * 100 : 0).toFixed(1)}%`;

export function MarketTradePanel({
  market,
  onClose,
}: {
  market: MarketBubbleNode;
  onClose: () => void;
}) {
  const [side, setSide] = useState<"Buy" | "Sell">("Buy");
  const polymarketUrl = market.polymarketUrl ?? market.marketUrl;

  return (
    <aside
      aria-label="Market trading panel"
      className="absolute inset-x-0 bottom-0 z-30 max-h-[78%] overflow-y-auto border-t border-zinc-700 bg-[#07080b]/97 p-4 shadow-2xl shadow-black/60 backdrop-blur-xl transition-transform md:inset-x-auto md:bottom-0 md:right-0 md:top-0 md:h-full md:w-[420px] md:max-h-none md:border-l md:border-t-0"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-cyan-300/80">{market.sport}</p>
          <h2 className="mt-2 text-xl font-semibold leading-tight tracking-tight text-zinc-50">{market.title}</h2>
          <p className="mt-3 text-sm text-zinc-400">
            Favored: <span className="font-semibold text-zinc-50">{market.favoredOutcome}</span>{" "}
            <span className="text-cyan-200">{formatCents(market.favoredPrice)}</span>
          </p>
        </div>
        <Button aria-label="Close market details" className="shrink-0" onClick={onClose} size="icon" type="button" variant="ghost">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {market.activeRangeWarning ? (
        <div className="mt-4 rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm font-medium text-amber-100">
          Market moved outside active range
        </div>
      ) : null}

      <div className="mt-5 grid grid-cols-3 gap-2">
        <button
          className={`h-9 rounded-md text-sm font-semibold transition ${side === "Buy" ? "bg-emerald-400 text-black" : "bg-zinc-900 text-zinc-300 hover:bg-zinc-800"}`}
          onClick={() => setSide("Buy")}
          type="button"
        >
          Buy
        </button>
        <button
          className={`h-9 rounded-md text-sm font-semibold transition ${side === "Sell" ? "bg-rose-400 text-black" : "bg-zinc-900 text-zinc-300 hover:bg-zinc-800"}`}
          onClick={() => setSide("Sell")}
          type="button"
        >
          Sell
        </button>
        <div className="grid place-items-center rounded-md border border-zinc-800 bg-zinc-950 text-xs font-semibold text-zinc-400">{side}</div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-md border border-zinc-800 bg-zinc-950/80 p-3">
          <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">Volume</p>
          <p className="mt-1 text-lg font-semibold text-zinc-100">{money(market.volume)}</p>
        </div>
        <div className="rounded-md border border-zinc-800 bg-zinc-950/80 p-3">
          <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">Liquidity</p>
          <p className="mt-1 text-lg font-semibold text-zinc-100">{money(market.liquidity)}</p>
        </div>
        <div className="rounded-md border border-zinc-800 bg-zinc-950/80 p-3">
          <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">Movement</p>
          <p className={market.priceChange >= 0 ? "mt-1 text-lg font-semibold text-emerald-300" : "mt-1 text-lg font-semibold text-rose-300"}>
            {formatMovement(market.priceChange)}
          </p>
        </div>
        <div className="rounded-md border border-zinc-800 bg-zinc-950/80 p-3">
          <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">Bid / Ask</p>
          <p className="mt-1 text-lg font-semibold text-zinc-100">
            {market.bestBid ? formatCents(market.bestBid) : "--"} / {market.bestAsk ? formatCents(market.bestAsk) : "--"}
          </p>
        </div>
      </div>

      <div className="mt-5 rounded-md border border-zinc-800 bg-zinc-950/85 p-3">
        <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">Outcomes</p>
        <div className="mt-3 space-y-2">
          {market.outcomes.map((outcome) => {
            const isFavored = outcome.name === market.favoredOutcome;
            return (
              <div
                className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 ${
                  isFavored ? "border-cyan-400/50 bg-cyan-400/10" : "border-zinc-800 bg-black/30"
                }`}
                key={`${market.id}-${outcome.name}`}
              >
                <span className="min-w-0 truncate font-semibold text-zinc-100">{outcome.name}</span>
                <span className="text-2xl font-black text-white">{formatCents(outcome.price)}</span>
              </div>
            );
          })}
        </div>
      </div>

      <TradeTicket market={market} />

      <div className="mt-5 grid gap-2">
        {polymarketUrl ? (
          <a
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-cyan-400 px-4 text-sm font-semibold text-black transition hover:bg-cyan-300"
            href={polymarketUrl}
            rel="noreferrer"
            target={polymarketUrl.startsWith("http") ? "_blank" : undefined}
          >
            Open on Polymarket
            <ExternalLink className="h-4 w-4" />
          </a>
        ) : null}
        <Button disabled type="button" variant="secondary">
          Execution disabled
        </Button>
      </div>
    </aside>
  );
}
