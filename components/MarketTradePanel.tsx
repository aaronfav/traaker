"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, ExternalLink, Loader2, RefreshCw, X } from "lucide-react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EstimateRow, MarketPanelHeader, OutcomeCard } from "@/components/markets/MarketUi";
import { categoryIcon, categoryIconSrc } from "@/lib/markets/category";
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

function formatMarketTitle(title: string) {
  return title.replace(/\s+vs\.?\s+/i, " vs. ");
}

function formatMarketTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  const isToday = date.toDateString() === today.toDateString();
  const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
  if (isToday) return `Today ${time}`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

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
  const slippageBps = DEFAULT_SLIPPAGE_BPS;
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
  const category = displayMarket.category && displayMarket.category !== "Market" ? displayMarket.category : "";
  const categoryMark = categoryIcon(category);
  const categoryMarkSrc = categoryIconSrc(category);
  const displayTitle = formatMarketTitle(displayMarket.title);
  const marketTime = formatMarketTime(displayMarket.startTime);
  const subtitle = [category || displayMarket.league || displayMarket.sport, marketTime].filter(Boolean).join(" · ");
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
        { side: "Buy" as const, price: buyPrice, className: "bg-[linear-gradient(135deg,#34d399_0%,#00c985_55%,#11b981_100%)] text-slate-950 hover:brightness-110" },
        { side: "Sell" as const, price: sellPrice, className: "bg-[linear-gradient(135deg,#fb7185_0%,#ff4d7a_52%,#f43f5e_100%)] text-slate-950 hover:brightness-110" },
      ]).map((action) => {
        const sideExecutionPrice = action.side === "Buy" ? maxBuyExecutionPrice : minSellExecutionPrice;
        const hasLiquidity = Number.isFinite(action.price) && Number.isFinite(sideExecutionPrice);
        const disabled = Boolean(tradeDisabledReason) || !selectedOutcome || !hasLiquidity || safeShares <= 0 || submittingSide !== null;
        const label =
          Number.isFinite(action.price) && selectedOutcome
            ? `${action.side} ${selectedOutcome.name}`
            : selectedOutcome
              ? "Not enough liquidity"
              : `${action.side} unavailable`;
        return (
          <Button
            aria-label={label}
            className={`h-16 min-w-0 flex-1 flex-col gap-1 rounded-xl text-sm font-black leading-none shadow-xl shadow-black/30 transition duration-200 ${Number.isFinite(action.price) ? action.className : ""}`}
            disabled={disabled}
            key={action.side}
            onClick={() => void createOrder(action.side)}
            type="button"
            variant={Number.isFinite(action.price) ? "default" : "secondary"}
            title={tradeDisabledReason ?? undefined}
          >
            {submittingSide === action.side ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            <span className="max-w-full truncate">{label}</span>
            {Number.isFinite(action.price) ? <span aria-hidden="true" className="text-xs font-semibold opacity-80">{formatCents(action.price as number)}</span> : null}
          </Button>
        );
      }),
    [buyPrice, createOrder, maxBuyExecutionPrice, minSellExecutionPrice, safeShares, selectedOutcome, sellPrice, submittingSide, tradeDisabledReason],
  );

  return (
    <aside
      aria-label="Market trading panel"
      className="absolute inset-x-0 bottom-0 z-30 flex max-h-[92svh] max-w-full flex-col overflow-hidden border-t border-slate-800/90 bg-[#070a12]/96 shadow-2xl shadow-black/70 backdrop-blur-2xl md:inset-x-auto md:bottom-0 md:right-0 md:top-0 md:h-full md:max-h-none md:w-[clamp(390px,30vw,480px)] md:border-l md:border-t-0"
      onClick={(event) => event.stopPropagation()}
    >
      <MarketPanelHeader
        category={category}
        categoryIcon={categoryMark ? <span className="text-sm leading-none">{categoryMark}</span> : undefined}
        status={quoteStatus === "refreshing" ? "Refreshing" : "Live"}
        timestamp={quoteLabel}
        title={displayTitle}
        subtitle={subtitle}
        actions={
          <>
          <Button aria-label="Refresh quote now" className="h-8 w-8" disabled={!onUpdatePrices || quoteStatus === "refreshing"} onClick={() => void refreshQuote()} size="icon" type="button" variant="ghost">
            <RefreshCw className={`h-3.5 w-3.5 ${quoteStatus === "refreshing" ? "animate-spin" : ""}`} />
          </Button>
          <Button aria-label="Close market details" className="h-8 w-8" onClick={onClose} size="icon" type="button" variant="ghost">
            <X className="h-4 w-4" />
          </Button>
          </>
        }
      />

      <div className="traak-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4 pb-6 sm:px-5">
        {displayMarket.activeRangeWarning ? (
          <div className="mb-4 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm font-medium text-amber-100">
            Market moved outside active range
          </div>
        ) : null}

        <div className="rounded-xl border border-slate-800/90 bg-slate-950/55 p-3 shadow-xl shadow-black/20">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Outcomes</p>
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
          <div className="traak-scrollbar grid max-h-[min(44svh,460px)] gap-2 overflow-y-auto pr-1">
            {displayMarket.outcomes.map((outcome) => {
              const selected = outcome.name === selectedOutcome?.name;
              return (
                <OutcomeCard
                  key={`${displayMarket.id}-${outcome.name}`}
                  name={outcome.name}
                  price={formatCents(outcome.price)}
                  logoUrl={outcome.outcomeLogoUrl}
                  teamDisplayName={outcome.teamDisplayName}
                  fallbackIcon={categoryMark}
                  fallbackIconSrc={categoryMarkSrc}
                  selected={selected}
                  onClick={() => setSelectedOutcomeName(outcome.name)}
                />
            );
          })}
          </div>
        </div>

        <label className="mt-4 block rounded-xl border border-slate-800/90 bg-slate-950/55 p-3 text-sm shadow-xl shadow-black/10">
          <span className="text-xs uppercase tracking-[0.16em] text-slate-500">Shares</span>
          <Input className="mt-2 h-12 rounded-lg border-slate-800 bg-black/70 text-base font-semibold shadow-inner shadow-black/20" min="0" onChange={(event) => setShares(event.target.value)} step="1" type="number" value={shares} />
        </label>

        <div className="mt-4 divide-y divide-slate-800/80 overflow-hidden rounded-xl border border-slate-800/90 bg-[linear-gradient(180deg,rgba(15,23,42,0.82),rgba(2,6,23,0.72))] text-sm shadow-xl shadow-black/15">
          <EstimateRow label="Est. cost" value={Number.isFinite(buyPrice) ? `$${(safeShares * (buyPrice as number)).toFixed(2)}` : "--"} />
          <EstimateRow label="Est. proceeds" value={Number.isFinite(sellPrice) ? `$${(safeShares * (sellPrice as number)).toFixed(2)}` : "--"} accent />
        </div>

        {orderId ? (
          <div className="mt-4 rounded-xl border border-slate-800 bg-black/35 p-3 text-xs text-slate-400">
            <span className="text-slate-500">Order hash/id</span>
            <p className="mt-1 break-all font-mono text-slate-200">{orderId}</p>
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

      <div className="border-t border-slate-800/90 bg-[#070a12]/98 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-[0_-18px_38px_rgba(0,0,0,0.4)]">
        <div className="grid grid-cols-2 gap-3">{actionButtons}</div>
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
