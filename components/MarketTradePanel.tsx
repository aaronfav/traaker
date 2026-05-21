"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, RefreshCw, X } from "lucide-react";
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
const QUOTE_REFRESH_MS = 10_000;
const QUOTE_TICK_MS = 250;
const QUOTE_RETRY_MS = 3_000;
type QuoteStatus = "healthy" | "refreshing" | "stale";

export function MarketTradePanel({
  market,
  onUpdatePrices,
  onClose,
}: {
  market: MarketBubbleNode;
  onUpdatePrices?: (market: MarketBubbleNode) => Promise<MarketBubbleNode | null>;
  onClose: () => void;
}) {
  const [side, setSide] = useState<"Buy" | "Sell">("Buy");
  const [displayMarket, setDisplayMarket] = useState(market);
  const [quoteUpdatedAt, setQuoteUpdatedAt] = useState<number | null>(null);
  const [quoteNow, setQuoteNow] = useState(() => Date.now());
  const [quoteExpiresAt, setQuoteExpiresAt] = useState(() => Date.now() + QUOTE_REFRESH_MS);
  const [quoteRetryAt, setQuoteRetryAt] = useState<number | null>(null);
  const [quoteStatus, setQuoteStatus] = useState<QuoteStatus>("healthy");
  const refreshInFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const activeMarketIdRef = useRef(market.id);
  const refreshTokenRef = useRef(0);
  const polymarketUrl = displayMarket.polymarketUrl ?? displayMarket.marketUrl;
  const isRefreshingQuote = quoteStatus === "refreshing";
  const isQuoteStale = quoteStatus === "stale";
  const cycleMs = isQuoteStale ? QUOTE_RETRY_MS : QUOTE_REFRESH_MS;
  const remainingMs = Math.max(0, quoteExpiresAt - quoteNow);
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  const quoteProgress = Math.min(1, Math.max(0, (cycleMs - remainingMs) / cycleMs));
  const quoteStrokeDashoffset = 40 - 40 * quoteProgress;
  const secondsSinceUpdate = quoteUpdatedAt !== null ? Math.max(0, Math.floor((quoteNow - quoteUpdatedAt) / 1000)) : null;

  useEffect(() => {
    mountedRef.current = true;
    activeMarketIdRef.current = market.id;
    refreshTokenRef.current += 1;
    setDisplayMarket(market);
    const now = Date.now();
    setQuoteUpdatedAt(now);
    setQuoteNow(now);
    setQuoteExpiresAt(now + QUOTE_REFRESH_MS);
    setQuoteRetryAt(null);
    setQuoteStatus("healthy");
    refreshInFlightRef.current = false;
    return () => {
      mountedRef.current = false;
    };
  }, [market]);

  const refreshQuote = useCallback(async () => {
    if (!onUpdatePrices || !mountedRef.current) return;
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    setQuoteStatus("refreshing");
    const requestToken = ++refreshTokenRef.current;
    const requestMarketId = activeMarketIdRef.current;
    try {
      const updated = await onUpdatePrices(displayMarket);
      if (!mountedRef.current || requestToken !== refreshTokenRef.current || requestMarketId !== activeMarketIdRef.current) return;
      if (updated) {
        setDisplayMarket(updated);
        const now = Date.now();
        setQuoteUpdatedAt(now);
        setQuoteNow(now);
        setQuoteExpiresAt(now + QUOTE_REFRESH_MS);
        setQuoteRetryAt(null);
        setQuoteStatus("healthy");
      } else {
        const retryAt = Date.now() + QUOTE_RETRY_MS;
        setQuoteRetryAt(retryAt);
        setQuoteExpiresAt(retryAt);
        setQuoteStatus("stale");
      }
    } catch {
      if (!mountedRef.current) return;
      if (requestToken !== refreshTokenRef.current || requestMarketId !== activeMarketIdRef.current) return;
      const retryAt = Date.now() + QUOTE_RETRY_MS;
      setQuoteRetryAt(retryAt);
      setQuoteExpiresAt(retryAt);
      setQuoteStatus("stale");
    } finally {
      if (mountedRef.current) setQuoteNow(Date.now());
      refreshInFlightRef.current = false;
    }
  }, [displayMarket, onUpdatePrices]);

  useEffect(() => {
    if (!onUpdatePrices) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      setQuoteNow(now);
      if (refreshInFlightRef.current) return;
      if (quoteStatus === "stale" && quoteRetryAt && now >= quoteRetryAt) {
        void refreshQuote();
        return;
      }
      if (quoteStatus !== "stale" && now >= quoteExpiresAt) {
        void refreshQuote();
      }
    }, QUOTE_TICK_MS);
    return () => window.clearInterval(timer);
  }, [onUpdatePrices, quoteExpiresAt, quoteRetryAt, quoteStatus, refreshQuote]);

  return (
    <aside
      aria-label="Market trading panel"
      className="absolute inset-x-0 bottom-0 z-30 max-h-[78%] overflow-y-auto border-t border-zinc-700 bg-[#07080b]/97 p-4 shadow-2xl shadow-black/60 backdrop-blur-xl transition-transform md:inset-x-auto md:bottom-0 md:right-0 md:top-0 md:h-full md:w-[420px] md:max-h-none md:border-l md:border-t-0"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-cyan-300/80">{displayMarket.sport}</p>
          <h2 className="mt-2 text-xl font-semibold leading-tight tracking-tight text-zinc-50">{displayMarket.title}</h2>
          <p className="mt-3 text-sm text-zinc-400">
            Favored: <span className="font-semibold text-zinc-50">{displayMarket.favoredOutcome}</span>{" "}
            <span className="text-cyan-200">{formatCents(displayMarket.favoredPrice)}</span>
          </p>
        </div>
        <Button aria-label="Close market details" className="shrink-0" onClick={onClose} size="icon" type="button" variant="ghost">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 rounded-md border border-zinc-800 bg-zinc-950/70 px-3 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className={`relative grid h-9 w-9 place-items-center rounded-full border ${
              isQuoteStale ? "border-amber-400/40 bg-amber-400/10" : isRefreshingQuote ? "border-cyan-400/40 bg-cyan-400/10" : "border-emerald-400/40 bg-emerald-400/10"
            }`}
          >
            <svg aria-hidden="true" className={`h-7 w-7 -rotate-90 ${isRefreshingQuote ? "animate-spin" : ""}`} viewBox="0 0 20 20">
              <circle cx="10" cy="10" r="6.4" fill="none" className="stroke-zinc-800" strokeWidth="1.8" />
              <circle
                cx="10"
                cy="10"
                r="6.4"
                fill="none"
                className={isQuoteStale ? "stroke-amber-300" : isRefreshingQuote ? "stroke-cyan-300" : "stroke-emerald-300"}
                strokeDasharray="40"
                strokeDashoffset={quoteStrokeDashoffset}
                strokeLinecap="round"
                strokeWidth="1.8"
              />
            </svg>
            <span className="absolute text-[10px] font-bold text-zinc-50">{isQuoteStale ? "!" : remainingSeconds}</span>
          </div>
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">Quote</p>
            <p className={`truncate text-sm font-medium ${isQuoteStale ? "text-amber-200" : isRefreshingQuote ? "text-cyan-200" : "text-emerald-200"}`}>
              {isQuoteStale ? "Quote temporarily unavailable" : isRefreshingQuote ? "Refreshing quote" : "Live quote"}
            </p>
            <p className="text-xs text-zinc-500">
              {isQuoteStale
                ? quoteRetryAt
                  ? `Retrying in ${Math.max(0, Math.ceil((quoteRetryAt - quoteNow) / 1000))}s`
                  : "Retrying"
                : secondsSinceUpdate === null
                  ? "Frozen quote"
                  : `Updated ${secondsSinceUpdate}s ago`}
            </p>
          </div>
        </div>
        <Button
          aria-label="Refresh quote now"
          className="h-8 w-8 shrink-0"
          disabled={!onUpdatePrices || isRefreshingQuote}
          onClick={() => void refreshQuote()}
          size="icon"
          type="button"
          variant="ghost"
          title="Refresh quote now"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isRefreshingQuote ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {displayMarket.activeRangeWarning ? (
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
          <p className="mt-1 text-lg font-semibold text-zinc-100">{money(displayMarket.volume)}</p>
        </div>
        <div className="rounded-md border border-zinc-800 bg-zinc-950/80 p-3">
          <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">Liquidity</p>
          <p className="mt-1 text-lg font-semibold text-zinc-100">{money(displayMarket.liquidity)}</p>
        </div>
        <div className="rounded-md border border-zinc-800 bg-zinc-950/80 p-3">
          <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">Movement</p>
          <p className={displayMarket.priceChange >= 0 ? "mt-1 text-lg font-semibold text-emerald-300" : "mt-1 text-lg font-semibold text-rose-300"}>
            {formatMovement(displayMarket.priceChange)}
          </p>
        </div>
        <div className="rounded-md border border-zinc-800 bg-zinc-950/80 p-3">
          <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">Bid / Ask</p>
          <p className="mt-1 text-lg font-semibold text-zinc-100">
            {displayMarket.bestBid ? formatCents(displayMarket.bestBid) : "--"} / {displayMarket.bestAsk ? formatCents(displayMarket.bestAsk) : "--"}
          </p>
        </div>
      </div>

      <div className="mt-5 rounded-md border border-zinc-800 bg-zinc-950/85 p-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">Outcomes</p>
          <span className="text-xs font-medium text-zinc-500">Snapshot</span>
        </div>
        <div className="mt-3 space-y-2">
          {displayMarket.outcomes.map((outcome) => {
            const isFavored = outcome.name === displayMarket.favoredOutcome;
            return (
              <div
                className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 ${
                  isFavored ? "border-cyan-400/50 bg-cyan-400/10" : "border-zinc-800 bg-black/30"
                }`}
                key={`${displayMarket.id}-${outcome.name}`}
              >
                <span className="min-w-0 truncate font-semibold text-zinc-100">{outcome.name}</span>
                <span className="text-2xl font-black text-white">{formatCents(outcome.price)}</span>
              </div>
            );
          })}
        </div>
      </div>

      <TradeTicket market={displayMarket} />

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
