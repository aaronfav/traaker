"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, ExternalLink, Loader2, RefreshCw, X } from "lucide-react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createSignerClient, SignatureTypeV2 } from "@/lib/polymarket/client";
import { getTradeDisabledReason } from "@/lib/polymarket/readiness";
import { placeMarketOrder, Side, validateTrade } from "@/lib/polymarket/orders";
import { ensureTradingReady, resolveTradingWalletContext, type TradeProgress } from "@/lib/polymarket/tradeSetup";
import type { MarketBubbleNode } from "@/components/MarketBubbleMap";

const QUOTE_REFRESH_MS = 10_000;
const QUOTE_TICK_MS = 250;
const QUOTE_RETRY_MS = 3_000;
const DEFAULT_SHARES = "10";
const DEFAULT_SLIPPAGE_BPS = 300;
const MAX_SLIPPAGE_BPS = 1_300;
const SLIPPAGE_PRESETS = [300, 500, 800, 1_300] as const;

type QuoteStatus = "healthy" | "refreshing" | "stale";
type TradeSide = "Buy" | "Sell";
type TradeToast = { tone: "success" | "error" | "info"; message: string };
type RuntimeConfig = {
  realTradingEnabled: boolean;
  builderReady: boolean;
  gaslessReady: boolean;
  clobReady: boolean;
  missingSetupReason: string | null;
};

const formatCents = (price: number) => `${Math.round(Math.max(0, Math.min(1, Number.isFinite(price) ? price : 0)) * 100)}\u00a2`;
const formatSeconds = (value: number | null) => (value === null ? "Live" : `Updated ${value}s ago`);

function priceForSide(market: MarketBubbleNode, outcomeIndex: number, side: TradeSide) {
  const outcome = market.outcomes[outcomeIndex];
  const outcomeBid = Number.isFinite(outcome?.bestBid) ? outcome?.bestBid : undefined;
  const outcomeAsk = Number.isFinite(outcome?.bestAsk) ? outcome?.bestAsk : undefined;
  if (side === "Buy" && Number.isFinite(outcomeAsk)) return outcomeAsk;
  if (side === "Sell" && Number.isFinite(outcomeBid)) return outcomeBid;
  const bestBid = Number.isFinite(market.bestBid) ? market.bestBid : undefined;
  const bestAsk = Number.isFinite(market.bestAsk) ? market.bestAsk : undefined;
  if (outcomeIndex === 0) {
    const quote = side === "Buy" ? bestAsk : bestBid;
    if (Number.isFinite(quote)) return quote;
  }
  if (outcomeIndex === 1) {
    const inverse = side === "Buy" ? bestBid : bestAsk;
    if (Number.isFinite(inverse)) return 1 - (inverse as number);
  }
  return Number.isFinite(outcome?.price) ? outcome?.price : undefined;
}

function extractOrderId(response: unknown) {
  if (!response || typeof response !== "object") return "";
  const record = response as Record<string, unknown>;
  return String(record.orderID ?? record.orderId ?? record.order_id ?? record.hash ?? record.id ?? "");
}

function userFacingTradeError(message: string) {
  return message;
}

function selectedOutcomeFromMarket(market: MarketBubbleNode, preferred?: string | null) {
  return market.outcomes.find((outcome) => outcome.name === preferred) ?? market.outcomes.find((outcome) => outcome.name === market.favoredOutcome) ?? market.outcomes[0];
}

function outcomePriceForSide(market: MarketBubbleNode, outcomeName: string, side: TradeSide) {
  const outcome = market.outcomes.find((item) => item.name === outcomeName);
  const outcomeIndex = Math.max(0, market.outcomes.findIndex((item) => item.name === outcome?.name));
  return priceForSide(market, outcomeIndex, side);
}

function useOptionalAccount() {
  try {
    return useAccount();
  } catch {
    return { chainId: undefined, isConnected: false };
  }
}

function useOptionalWalletClient() {
  try {
    return useWalletClient({ chainId: 137 }).data;
  } catch {
    return undefined;
  }
}

function useOptionalPublicClient() {
  try {
    return usePublicClient({ chainId: 137 });
  } catch {
    return undefined;
  }
}

export function MarketTradePanel({
  market,
  onUpdatePrices,
  onClose,
}: {
  market: MarketBubbleNode;
  onUpdatePrices?: (market: MarketBubbleNode) => Promise<MarketBubbleNode | null>;
  onClose: () => void;
}) {
  const { chainId, isConnected } = useOptionalAccount();
  const publicClient = useOptionalPublicClient();
  const walletClient = useOptionalWalletClient();
  const [displayMarket, setDisplayMarket] = useState(market);
  const [selectedOutcomeName, setSelectedOutcomeName] = useState(() => selectedOutcomeFromMarket(market)?.name ?? "");
  const [shares, setShares] = useState(DEFAULT_SHARES);
  const [slippageBps, setSlippageBps] = useState<number>(DEFAULT_SLIPPAGE_BPS);
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig>({
    realTradingEnabled: false,
    builderReady: false,
    gaslessReady: false,
    clobReady: false,
    missingSetupReason: null,
  });
  const [depositWalletInitialized, setDepositWalletInitialized] = useState<boolean | null>(null);
  const [submittingSide, setSubmittingSide] = useState<TradeSide | null>(null);
  const [tradeProgress, setTradeProgress] = useState<TradeProgress>("idle");
  const [toast, setToast] = useState<TradeToast | null>(null);
  const [orderId, setOrderId] = useState("");
  const [quoteUpdatedAt, setQuoteUpdatedAt] = useState<number | null>(null);
  const [quoteNow, setQuoteNow] = useState(() => Date.now());
  const [quoteExpiresAt, setQuoteExpiresAt] = useState(() => Date.now() + QUOTE_REFRESH_MS);
  const [quoteRetryAt, setQuoteRetryAt] = useState<number | null>(null);
  const [quoteStatus, setQuoteStatus] = useState<QuoteStatus>("healthy");
  const refreshInFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const activeMarketIdRef = useRef(market.id);
  const refreshTokenRef = useRef(0);
  const lastMarketIdRef = useRef(market.id);

  const selectedOutcome = selectedOutcomeFromMarket(displayMarket, selectedOutcomeName);
  const selectedOutcomeIndex = Math.max(0, displayMarket.outcomes.findIndex((outcome) => outcome.name === selectedOutcome?.name));
  const buyPrice = priceForSide(displayMarket, selectedOutcomeIndex, "Buy");
  const sellPrice = priceForSide(displayMarket, selectedOutcomeIndex, "Sell");
  const slippageFactor = slippageBps / 10_000;
  const maxBuyExecutionPrice = Number.isFinite(buyPrice) ? Math.min(0.99, (buyPrice as number) * (1 + slippageFactor)) : null;
  const minSellExecutionPrice = Number.isFinite(sellPrice) ? Math.max(0.01, (sellPrice as number) * (1 - slippageFactor)) : null;
  const quoteAgeMs = quoteUpdatedAt === null ? null : Math.max(0, quoteNow - quoteUpdatedAt);
  const quoteIsStale = quoteStatus === "stale" || (quoteAgeMs !== null && quoteAgeMs >= QUOTE_REFRESH_MS);
  const numericShares = Number(shares);
  const safeShares = Number.isFinite(numericShares) ? Math.max(0, numericShares) : 0;
  const secondsSinceUpdate = quoteUpdatedAt !== null ? Math.max(0, Math.floor((quoteNow - quoteUpdatedAt) / 1000)) : null;
  const quoteLabel = quoteStatus === "refreshing" ? "Refreshing quote" : formatSeconds(secondsSinceUpdate);
  const polymarketUrl = displayMarket.polymarketUrl ?? displayMarket.marketUrl;
  const tradeDisabledReason = getTradeDisabledReason({
    configReady: runtimeConfig.clobReady,
    configError: runtimeConfig.missingSetupReason,
    realTradingEnabled: runtimeConfig.realTradingEnabled,
    isConnected,
    chainId,
    depositWalletInitialized,
    balance: null,
    quoteFresh: true,
  });

  useEffect(() => {
    mountedRef.current = true;
    activeMarketIdRef.current = market.id;
    refreshTokenRef.current += 1;
    setDisplayMarket(market);
    setSelectedOutcomeName((current) => {
      if (lastMarketIdRef.current !== market.id) return selectedOutcomeFromMarket(market)?.name ?? "";
      return selectedOutcomeFromMarket(market, current)?.name ?? selectedOutcomeFromMarket(market)?.name ?? "";
    });
    lastMarketIdRef.current = market.id;
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

  useEffect(() => {
    let active = true;
    fetch("/api/polymarket/config", { cache: "no-store" })
      .then((response) => response.json())
      .then((data: { ok?: boolean; realTradingEnabled?: boolean; builderReady?: boolean; gaslessReady?: boolean; clobReady?: boolean; missingSetupReason?: string | null; error?: string }) => {
        if (!active) return;
        if (!data.ok) {
          setRuntimeConfig({
            realTradingEnabled: false,
            builderReady: false,
            gaslessReady: false,
            clobReady: false,
            missingSetupReason: data.error ?? "Trading configuration is unavailable.",
          });
          return;
        }
        setRuntimeConfig({
          realTradingEnabled: Boolean(data.realTradingEnabled),
          builderReady: Boolean(data.builderReady),
          gaslessReady: Boolean(data.gaslessReady),
          clobReady: Boolean(data.clobReady),
          missingSetupReason: data.missingSetupReason ?? null,
        });
      })
      .catch(() => {
        if (!active) return;
        setRuntimeConfig({
          realTradingEnabled: false,
          builderReady: false,
          gaslessReady: false,
          clobReady: false,
          missingSetupReason: "Trading configuration is unavailable.",
        });
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    if (!isConnected || chainId !== 137 || !walletClient || !publicClient) {
      setDepositWalletInitialized(null);
      return () => {
        active = false;
      };
    }

    const address = walletClient.account?.address;
    if (!address) {
      setDepositWalletInitialized(null);
      return () => {
        active = false;
      };
    }

    void resolveTradingWalletContext({ walletClient, address: address as `0x${string}`, publicClient })
      .then(async (context) => {
        if (!active) return;
        setDepositWalletInitialized(context.walletMode === "legacy-proxy" ? true : context.depositWalletInitialized);
      })
      .catch(() => {
        if (!active) return;
        setDepositWalletInitialized(null);
      });

    return () => {
      active = false;
    };
  }, [chainId, isConnected, publicClient, walletClient]);

  const refreshQuote = useCallback(async (): Promise<MarketBubbleNode | null> => {
    if (!onUpdatePrices || !mountedRef.current) return null;
    if (refreshInFlightRef.current) return null;
    refreshInFlightRef.current = true;
    setQuoteStatus("refreshing");
    const requestToken = ++refreshTokenRef.current;
    const requestMarketId = activeMarketIdRef.current;
    try {
      const updated = await onUpdatePrices(displayMarket);
      if (!mountedRef.current || requestToken !== refreshTokenRef.current || requestMarketId !== activeMarketIdRef.current) return null;
      if (updated) {
        setDisplayMarket(updated);
        setSelectedOutcomeName((current) => selectedOutcomeFromMarket(updated, current)?.name ?? selectedOutcomeFromMarket(updated)?.name ?? "");
        const now = Date.now();
        setQuoteUpdatedAt(now);
        setQuoteNow(now);
        setQuoteExpiresAt(now + QUOTE_REFRESH_MS);
        setQuoteRetryAt(null);
        setQuoteStatus("healthy");
        return updated;
      } else {
        const retryAt = Date.now() + QUOTE_RETRY_MS;
        setQuoteRetryAt(retryAt);
        setQuoteExpiresAt(retryAt);
        setQuoteStatus("stale");
      }
    } catch {
      if (!mountedRef.current) return null;
      if (requestToken !== refreshTokenRef.current || requestMarketId !== activeMarketIdRef.current) return null;
      const retryAt = Date.now() + QUOTE_RETRY_MS;
      setQuoteRetryAt(retryAt);
      setQuoteExpiresAt(retryAt);
      setQuoteStatus("stale");
    } finally {
      if (mountedRef.current) setQuoteNow(Date.now());
      refreshInFlightRef.current = false;
    }
    return null;
  }, [displayMarket, onUpdatePrices]);

  const refreshQuoteWithRetry = useCallback(async () => {
    if (!onUpdatePrices) return null;
    const first = await refreshQuote();
    if (first) return first;
    return refreshQuote();
  }, [onUpdatePrices, refreshQuote]);

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

  const createOrder = useCallback(
    async (side: TradeSide) => {
      let tradeMarket = displayMarket;
      let setup: Awaited<ReturnType<typeof ensureTradingReady>> | null = null;
      const outcome = selectedOutcomeFromMarket(tradeMarket, selectedOutcomeName);
      const price = side === "Buy" ? outcomePriceForSide(tradeMarket, outcome?.name ?? "", "Buy") : outcomePriceForSide(tradeMarket, outcome?.name ?? "", "Sell");
      if (!outcome || !Number.isFinite(price)) return;
      setSubmittingSide(side);
      setToast(null);
      setOrderId("");
      setTradeProgress("checking-wallet");

      const tokenID = outcome.tokenId ?? "";
      const orderValue = safeShares * (Number.isFinite(price) ? (price as number) : 0);

      try {
        if (!isConnected) {
          setToast({ tone: "error", message: "Connect a wallet before trading." });
          return;
        }
        if (chainId !== 137) {
          setToast({ tone: "error", message: "Switch to Polygon mainnet before trading." });
          return;
        }
        if (!tokenID) {
          setToast({ tone: "error", message: "This outcome is missing a CLOB token id." });
          return;
        }
        if (safeShares <= 0 || orderValue <= 0) {
          setToast({ tone: "error", message: "Enter an order size greater than 0." });
          return;
        }
        if (!walletClient) {
          setToast({ tone: "error", message: "Connect a wallet before trading." });
          return;
        }

        if (onUpdatePrices && (quoteIsStale || !Number.isFinite(price))) {
          setTradeProgress("refreshing-quote");
          const refreshed = await refreshQuoteWithRetry();
          if (refreshed) {
            tradeMarket = refreshed;
          }
        }

        const refreshedOutcome = selectedOutcomeFromMarket(tradeMarket, selectedOutcomeName);
        const refreshedPrice =
          side === "Buy"
            ? outcomePriceForSide(tradeMarket, refreshedOutcome?.name ?? "", "Buy")
            : outcomePriceForSide(tradeMarket, refreshedOutcome?.name ?? "", "Sell");
        const finalPrice = Number.isFinite(refreshedPrice) ? refreshedPrice : price;
        if (!refreshedOutcome || !Number.isFinite(finalPrice)) {
          setToast({ tone: "error", message: "Unable to refresh the quote. Try again in a moment." });
          return;
        }
        const finalOrderValue = safeShares * (finalPrice as number);

        let availableBalance = Number.MAX_SAFE_INTEGER;
        if (runtimeConfig.realTradingEnabled) {
          const walletAddress = walletClient.account?.address;
          if (!walletAddress) {
            setToast({ tone: "error", message: "Connect a wallet before trading." });
            return;
          }
          setup = await ensureTradingReady({
            walletClient,
            address: walletAddress as `0x${string}`,
            publicClient,
            side,
            tokenId: tokenID,
            amount: finalOrderValue,
            price: finalPrice as number,
            onProgress: setTradeProgress,
          });
          setDepositWalletInitialized(setup.depositWalletInitialized);
          availableBalance = Number.MAX_SAFE_INTEGER;
        }

        const validation = validateTrade({
          walletConnected: isConnected,
          chainId: chainId ?? 0,
          tokenID,
          amount: finalOrderValue,
          price: finalPrice as number,
          slippageBps,
          availableBalance,
        });

        if (!validation.ok) {
          setToast({ tone: "error", message: userFacingTradeError(validation.errors[0] ?? "Trade validation failed.") });
          return;
        }

        if (!runtimeConfig.realTradingEnabled) {
          setToast({ tone: "success", message: `${side} ${refreshedOutcome.name} validated at ${formatCents(finalPrice as number)}. Real order submission is disabled.` });
          return;
        }

        setTradeProgress("submitting-order");
        if (!setup) {
          throw new Error("Trading setup is unavailable.");
        }
        const client = await createSignerClient({
          signer: walletClient,
          signatureType: setup.signatureType === 2 ? SignatureTypeV2.POLY_GNOSIS_SAFE : SignatureTypeV2.POLY_1271,
          funderAddress: setup.tradingWalletAddress,
        });
        const response = await placeMarketOrder(client, {
          tokenID,
          amount: finalOrderValue,
          currentPrice: finalPrice as number,
          maxSlippageBps: slippageBps,
          side: side === "Buy" ? Side.BUY : Side.SELL,
          userUSDCBalance: side === "Buy" ? availableBalance : undefined,
        });
        const nextOrderId = extractOrderId(response);
        setOrderId(nextOrderId);
        setToast({ tone: "success", message: nextOrderId ? `Order submitted: ${nextOrderId}` : `${side} order submitted.` });
      } catch (error) {
        setToast({
          tone: "error",
          message: error instanceof Error ? error.message : "Polymarket rejected the order. Check wallet setup, balance, allowances, and market liquidity.",
        });
      } finally {
        setSubmittingSide(null);
        setTradeProgress("idle");
      }
    },
    [chainId, displayMarket, isConnected, onUpdatePrices, publicClient, quoteIsStale, refreshQuoteWithRetry, runtimeConfig.realTradingEnabled, safeShares, selectedOutcomeName, slippageBps, walletClient],
  );

  const actionButtons = useMemo(
    () =>
      ([ 
        { side: "Buy" as const, price: buyPrice, className: "bg-emerald-400 text-slate-950 hover:bg-emerald-300" },
        { side: "Sell" as const, price: sellPrice, className: "bg-rose-400 text-slate-950 hover:bg-rose-300" },
      ]).map((action) => {
        const sideExecutionPrice = action.side === "Buy" ? maxBuyExecutionPrice : minSellExecutionPrice;
        const hasLiquidity = Number.isFinite(action.price) && Number.isFinite(sideExecutionPrice);
        const disabled = Boolean(tradeDisabledReason) || !selectedOutcome || !hasLiquidity || safeShares <= 0 || submittingSide !== null;
        const label =
          Number.isFinite(action.price) && selectedOutcome
            ? `${action.side} ${selectedOutcome.name}`
            : selectedOutcome
              ? "Not enough liquidity within slippage"
              : `${action.side} unavailable`;
        return (
          <Button
            className={`h-12 flex-1 text-sm font-black leading-none shadow-lg shadow-black/25 ${Number.isFinite(action.price) ? action.className : ""}`}
            disabled={disabled}
            key={action.side}
            onClick={() => void createOrder(action.side)}
            type="button"
            variant={Number.isFinite(action.price) ? "default" : "secondary"}
            title={tradeDisabledReason ?? undefined}
          >
            {submittingSide === action.side ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            <span>{label}</span>
          </Button>
        );
      }),
    [buyPrice, createOrder, maxBuyExecutionPrice, minSellExecutionPrice, safeShares, selectedOutcome, sellPrice, submittingSide, tradeDisabledReason],
  );

  return (
    <aside
      aria-label="Market trading panel"
      className="absolute inset-x-0 bottom-0 z-30 flex max-h-[84%] flex-col overflow-hidden border-t border-zinc-800/90 bg-[#07080b]/98 shadow-2xl shadow-black/60 backdrop-blur-xl md:inset-x-auto md:bottom-0 md:right-0 md:top-0 md:h-full md:max-h-none md:w-[420px] md:border-l md:border-t-0"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-4 border-b border-zinc-800/80 px-4 py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-200">
              {quoteStatus === "refreshing" ? "Refreshing" : "Live"}
            </span>
            <span className="text-xs text-zinc-500">{quoteLabel}</span>
          </div>
          <h2 className="mt-2 line-clamp-2 text-lg font-semibold leading-tight tracking-tight text-zinc-50">{displayMarket.title}</h2>
          {selectedOutcome ? <p className="mt-1 truncate text-sm font-medium text-cyan-100">{selectedOutcome.name}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button aria-label="Refresh quote now" className="h-8 w-8" disabled={!onUpdatePrices || quoteStatus === "refreshing"} onClick={() => void refreshQuote()} size="icon" type="button" variant="ghost">
            <RefreshCw className={`h-3.5 w-3.5 ${quoteStatus === "refreshing" ? "animate-spin" : ""}`} />
          </Button>
          <Button aria-label="Close market details" className="h-8 w-8" onClick={onClose} size="icon" type="button" variant="ghost">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 pb-5">
        {displayMarket.activeRangeWarning ? (
          <div className="mb-4 rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm font-medium text-amber-100">
            Market moved outside active range
          </div>
        ) : null}

        <div className="rounded-lg border border-zinc-800/90 bg-zinc-950/70 p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">Outcomes</p>
            {polymarketUrl ? (
              <a
                className="inline-flex items-center gap-1 text-xs font-semibold text-cyan-200 transition hover:text-cyan-100"
                href={polymarketUrl}
                rel="noreferrer"
                target={polymarketUrl.startsWith("http") ? "_blank" : undefined}
              >
                Polymarket
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : null}
          </div>
          <div className="grid gap-2">
            {displayMarket.outcomes.map((outcome) => {
              const selected = outcome.name === selectedOutcome?.name;
              return (
                <button
                  className={`flex min-h-12 items-center justify-between gap-3 rounded-md border px-3 py-2 text-left transition ${
                    selected ? "border-cyan-300/60 bg-cyan-300/10 text-white shadow-[0_0_24px_rgba(34,211,238,0.08)]" : "border-zinc-800 bg-black/25 text-zinc-200 hover:border-zinc-600"
                  }`}
                  key={`${displayMarket.id}-${outcome.name}`}
                  onClick={() => setSelectedOutcomeName(outcome.name)}
                  type="button"
                >
                  <span className="min-w-0 truncate text-sm font-semibold">{outcome.name}</span>
                  <span className="shrink-0 text-lg font-black">{formatCents(outcome.price)}</span>
                </button>
            );
          })}
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-zinc-800/90 bg-zinc-950/70 p-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">Slippage</p>
            <div className="flex rounded-md border border-zinc-800 bg-black p-0.5">
              {SLIPPAGE_PRESETS.map((preset) => (
                <button
                  aria-pressed={slippageBps === preset}
                  className={`h-7 rounded px-3 text-xs font-semibold transition ${
                    slippageBps === preset ? "bg-zinc-100 text-black" : "text-zinc-400 hover:text-zinc-100"
                  }`}
                  key={preset}
                  onClick={() => setSlippageBps(preset)}
                  type="button"
                >
                  {preset === MAX_SLIPPAGE_BPS ? "13%" : `${preset / 100}%`}
                </button>
              ))}
            </div>
          </div>
        </div>

        <label className="mt-4 block rounded-lg border border-zinc-800/90 bg-zinc-950/70 p-3 text-sm">
          <span className="text-xs uppercase tracking-[0.16em] text-zinc-500">Shares</span>
          <Input className="mt-2 border-zinc-800 bg-black text-base font-semibold" min="0" onChange={(event) => setShares(event.target.value)} step="1" type="number" value={shares} />
        </label>

        <div className="mt-4 rounded-lg border border-zinc-800/90 bg-zinc-950/70 p-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-zinc-400">Est. cost</span>
            <span className="font-semibold text-zinc-50">{Number.isFinite(buyPrice) ? `$${(safeShares * (buyPrice as number)).toFixed(2)}` : "--"}</span>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-zinc-400">Est. proceeds</span>
            <span className="font-semibold text-zinc-50">{Number.isFinite(sellPrice) ? `$${(safeShares * (sellPrice as number)).toFixed(2)}` : "--"}</span>
          </div>
        </div>

        {orderId ? (
          <div className="mt-4 rounded-lg border border-zinc-800 bg-black/35 p-3 text-xs text-zinc-400">
            <span className="text-zinc-500">Order hash/id</span>
            <p className="mt-1 break-all font-mono text-zinc-200">{orderId}</p>
          </div>
        ) : null}

        {toast ? (
          <div
            className={`mt-4 flex gap-2 rounded-lg border p-3 text-sm ${
              toast.tone === "success"
                ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"
                : toast.tone === "error"
                  ? "border-rose-400/30 bg-rose-400/10 text-rose-100"
                  : "border-cyan-400/30 bg-cyan-400/10 text-cyan-100"
            }`}
          >
            {toast.tone === "success" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
            <span className="break-words">{toast.message}</span>
          </div>
        ) : null}
      </div>

      <div className="border-t border-zinc-800/90 bg-[#07080b]/98 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-[0_-18px_38px_rgba(0,0,0,0.32)]">
        <div className="flex gap-2">{actionButtons}</div>
        {tradeProgress !== "idle" ? (
          <p className="mt-2 text-[11px] uppercase tracking-[0.18em] text-cyan-200">
            {tradeProgress === "checking-wallet"
              ? "Checking wallet"
              : tradeProgress === "initializing-trading-wallet"
                ? "Initializing trading wallet"
                : tradeProgress === "checking-balance"
                  ? "Checking balance"
                  : tradeProgress === "approving-trading"
                    ? "Approving trading"
                    : tradeProgress === "refreshing-quote"
                      ? "Refreshing quote"
                      : "Submitting order"}
          </p>
        ) : null}
        {tradeDisabledReason ? <p className="mt-2 text-[11px] leading-4 text-amber-200">{tradeDisabledReason}</p> : null}
      </div>

      {toast ? (
        <div
          className={`fixed bottom-4 right-4 z-50 max-w-sm rounded-lg border p-3 text-sm shadow-2xl ${
            toast.tone === "success" ? "border-emerald-400/30 bg-emerald-950 text-emerald-100" : "border-rose-400/30 bg-rose-950 text-rose-100"
          }`}
        >
          {toast.message}
        </div>
      ) : null}
    </aside>
  );
}
