"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, ExternalLink, Loader2, RefreshCw, X } from "lucide-react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EstimateRow, MarketPanelHeader, OutcomeCard } from "@/components/markets/MarketUi";
import type { EnrichedMarket } from "@/lib/sports/enrichmentTypes";
import { categoryIcon, categoryIconSrc } from "@/lib/markets/category";
import { createSignerClient, SignatureTypeV2 } from "@/lib/polymarket/client";
import { sharedMarketOutcomeIconUrl, shouldUseOutcomeTeamLogos } from "@/lib/polymarket/marketDisplay";
import { getTradeDisabledReason } from "@/lib/polymarket/readiness";
import { isDepositWalletRequiredError, placeMarketOrder, Side, validateTrade } from "@/lib/polymarket/orders";
import {
  ensureTradingReady,
  markDepositWalletRequired,
  resolveTradingWalletContext,
  type TradeProgress,
} from "@/lib/polymarket/tradeSetup";
import { countryFlagUrl, resolveCountryTeam } from "@/lib/sports/countryTeams";
import { normalizeSportsEntityName } from "@/lib/sports/sportsResolverService";
import type { MarketBubbleNode } from "@/components/MarketBubbleMap";

const QUOTE_REFRESH_MS = 10_000;
const QUOTE_TICK_MS = 250;
const QUOTE_RETRY_MS = 3_000;
const DEFAULT_SHARES = "10";
const DEFAULT_SLIPPAGE_BPS = 300;
const POLYMARKET_UPLOAD_HOST = "https://polymarket-upload.s3.us-east-2.amazonaws.com/";

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

function confidentOutcomeLogo(outcome: {
  outcomeLogoUrl?: string;
  polymarketParticipantLogoUrl?: string;
  polymarketTeamLogoUrl?: string;
  logoConfidence?: string;
  isTeamOutcome?: boolean;
  isLogoOutcome?: boolean;
  entityType?: string;
}, sharedLogo?: string | null) {
  const resolved = outcome.outcomeLogoUrl ?? outcome.polymarketParticipantLogoUrl ?? outcome.polymarketTeamLogoUrl ?? sharedLogo ?? undefined;
  if (!resolved) return undefined;
  if (outcome.isLogoOutcome === false) return undefined;
  if (outcome.entityType === "fallback" || outcome.entityType === "non_team") return undefined;
  const hostIndex = resolved.lastIndexOf(POLYMARKET_UPLOAD_HOST);
  const displayLogoUrl =
    hostIndex > 0 ? `${POLYMARKET_UPLOAD_HOST}${resolved.slice(hostIndex + POLYMARKET_UPLOAD_HOST.length)}` : resolved;
  if (!outcome.logoConfidence || ["exact_normalized_match", "alias_match", "league_team_match", "provider_exact_name", "provider_alias_name", "provider_shortcode"].includes(outcome.logoConfidence)) {
    return displayLogoUrl;
  }
  return undefined;
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
  presentation = "drawer",
}: {
  market: MarketBubbleNode;
  onUpdatePrices?: (market: MarketBubbleNode) => Promise<MarketBubbleNode | null>;
  onClose: () => void;
  presentation?: "drawer" | "modal";
}) {
  const isModal = presentation === "modal";
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
  const [enrichment, setEnrichment] = useState<EnrichedMarket | null>(null);
  const [enrichmentError, setEnrichmentError] = useState("");
  const refreshInFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const activeMarketIdRef = useRef(market.id);
  const refreshTokenRef = useRef(0);
  const lastMarketIdRef = useRef(market.id);
  const bodyRef = useRef<HTMLDivElement>(null);

  const selectedOutcome = selectedOutcomeFromMarket(displayMarket, selectedOutcomeName);
  const category = displayMarket.category && displayMarket.category !== "Market" ? displayMarket.category : "";
  const categoryMark = categoryIcon(category);
  const categoryMarkSrc = categoryIconSrc(category);
  const useTeamLogos = shouldUseOutcomeTeamLogos(displayMarket);
  const sharedMarketLogo = sharedMarketOutcomeIconUrl(displayMarket) || categoryMarkSrc || undefined;
  const displayTitle = formatMarketTitle(displayMarket.title);
  const marketTime = formatMarketTime(displayMarket.startTime);
  const subtitle = [category || displayMarket.league || displayMarket.sport, marketTime].filter(Boolean).join(" - ");
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
  const enrichmentParticipantsByName = useMemo(() => {
    const map = new Map<string, NonNullable<EnrichedMarket["participants"]>[number]>();
    for (const participant of enrichment?.participants ?? []) {
      map.set(normalizeSportsEntityName(participant.name), participant);
    }
    return map;
  }, [enrichment?.participants]);
  const enrichmentSummary = enrichment?.context.standings ?? enrichment?.context.headToHead ?? enrichment?.context.lastGames?.join(" - ");
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
    bodyRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [market.id]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setEnrichment(null);
    setEnrichmentError("");
    void fetch("/api/markets/enrich", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ market }),
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as { market?: EnrichedMarket; error?: string } | null;
        if (!active) return;
        if (!response.ok) {
          setEnrichmentError(payload?.error ?? "Unable to enrich this market.");
          return;
        }
        setEnrichment(payload?.market ?? null);
      })
      .catch(() => {
        if (active) setEnrichmentError("Unable to enrich this market.");
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [market]);

  useEffect(() => {
    if (!isModal) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isModal, onClose]);

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
      const walletAddress = walletClient?.account?.address;
      const outcome = selectedOutcomeFromMarket(tradeMarket, selectedOutcomeName);
      const price = side === "Buy" ? outcomePriceForSide(tradeMarket, outcome?.name ?? "", "Buy") : outcomePriceForSide(tradeMarket, outcome?.name ?? "", "Sell");
      if (!outcome || !Number.isFinite(price)) return;
      if (!isConnected) {
        setToast({ tone: "error", message: "Connect a wallet before trading." });
        return;
      }
      if (chainId !== 137) {
        setToast({ tone: "error", message: "Switch to Polygon mainnet before trading." });
        return;
      }
      if (!walletClient || !walletAddress) {
        setToast({ tone: "error", message: "Connect a wallet before trading." });
        return;
      }
      const tokenID = outcome.tokenId ?? "";
      const orderValue = safeShares * (Number.isFinite(price) ? (price as number) : 0);
      if (!tokenID) {
        setToast({ tone: "error", message: "This outcome is missing a CLOB token id." });
        return;
      }
      if (safeShares <= 0 || orderValue <= 0) {
        setToast({ tone: "error", message: "Enter an order size greater than 0." });
        return;
      }

      const submitOnce = async (forceDepositWallet = false) => {
        let setup: Awaited<ReturnType<typeof ensureTradingReady>> | null = null;
        let activeMarket = tradeMarket;
        const initialOutcome = selectedOutcomeFromMarket(activeMarket, selectedOutcomeName);
        const initialPrice = side === "Buy" ? outcomePriceForSide(activeMarket, initialOutcome?.name ?? "", "Buy") : outcomePriceForSide(activeMarket, initialOutcome?.name ?? "", "Sell");
        if (onUpdatePrices && (quoteIsStale || !Number.isFinite(initialPrice))) {
          setTradeProgress("refreshing-quote");
          const refreshed = await refreshQuoteWithRetry();
          if (refreshed) {
            activeMarket = refreshed;
            tradeMarket = refreshed;
          }
        }

        const refreshedOutcome = selectedOutcomeFromMarket(activeMarket, selectedOutcomeName);
        const refreshedPrice =
          side === "Buy"
            ? outcomePriceForSide(activeMarket, refreshedOutcome?.name ?? "", "Buy")
            : outcomePriceForSide(activeMarket, refreshedOutcome?.name ?? "", "Sell");
        const finalPrice = Number.isFinite(refreshedPrice) ? refreshedPrice : initialPrice;
        if (!refreshedOutcome || !Number.isFinite(finalPrice)) {
          throw new Error("Unable to refresh the quote. Try again in a moment.");
        }
        const finalOrderValue = safeShares * (finalPrice as number);

        let availableBalance = Number.MAX_SAFE_INTEGER;
        if (runtimeConfig.realTradingEnabled) {
          if (forceDepositWallet) markDepositWalletRequired(walletAddress);
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
          throw new Error(userFacingTradeError(validation.errors[0] ?? "Trade validation failed."));
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
      };

      setSubmittingSide(side);
      setToast(null);
      setOrderId("");
      setTradeProgress("checking-wallet");

      try {
        await submitOnce(false);
      } catch (error) {
        if (!isDepositWalletRequiredError(error) || !walletAddress) {
          setToast({
            tone: "error",
            message: error instanceof Error ? error.message : "Polymarket rejected the order. Check wallet setup, balance, allowances, and market liquidity.",
          });
          return;
        }
        try {
          setTradeProgress("initializing-trading-wallet");
          await submitOnce(true);
        } catch (retryError) {
          setToast({
            tone: "error",
            message: retryError instanceof Error ? retryError.message : "Polymarket rejected the order. Check wallet setup, balance, allowances, and market liquidity.",
          });
        }
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
    <>
      {isModal ? (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-40 bg-slate-950/58 backdrop-blur-[2px]"
          onClick={onClose}
        />
      ) : null}
      <aside
        aria-label="Market trading panel"
        aria-modal={isModal ? true : undefined}
        className={
          isModal
            ? "traak-trade-panel traak-trade-panel-modal fixed inset-0 z-50 flex h-[100svh] w-full max-w-none flex-col overflow-hidden overscroll-contain border-0 bg-[var(--surface)] shadow-[0_40px_120px_rgba(15,23,42,0.28)] backdrop-blur-2xl sm:left-1/2 sm:top-1/2 sm:h-[min(88svh,900px)] sm:w-[min(100vw-2rem,1040px)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[1.75rem] sm:border sm:border-[var(--border)]"
            : "traak-trade-panel absolute inset-x-0 bottom-0 z-30 flex max-h-[92svh] max-w-full flex-col overflow-hidden overscroll-contain border-t border-[var(--border)] bg-[var(--surface)] shadow-2xl shadow-black/70 backdrop-blur-2xl md:inset-x-auto md:bottom-0 md:right-0 md:top-0 md:h-full md:max-h-none md:w-[clamp(420px,33vw,560px)] md:border-l md:border-t-0"
        }
        role={isModal ? "dialog" : "complementary"}
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
          <div className="flex items-center gap-1.5">
            <Button
              aria-label="Refresh quote now"
              className="h-8 w-8"
              disabled={!onUpdatePrices || quoteStatus === "refreshing"}
              onClick={() => void refreshQuote()}
              size="icon"
              type="button"
              variant="ghost"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${quoteStatus === "refreshing" ? "animate-spin" : ""}`} />
            </Button>
            <Button
              aria-label="Close market details"
              className={`h-8 ${isModal ? "gap-1.5 rounded-full px-3 text-xs font-semibold" : "w-8"}`}
              onClick={onClose}
              size={isModal ? "default" : "icon"}
              type="button"
              variant={isModal ? "outline" : "ghost"}
            >
              <X className="h-4 w-4" />
              {isModal ? <span className="hidden sm:inline">Close</span> : null}
            </Button>
          </div>
        }
        />

      <div ref={bodyRef} className="traak-scrollbar traak-trade-panel-body min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 pb-8 sm:px-5">
        {displayMarket.activeRangeWarning ? (
          <div className="mb-4 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm font-medium text-amber-100">
            Market moved outside active range
          </div>
        ) : null}

        <div className="traak-trade-panel-section rounded-xl border border-[var(--border)] bg-[var(--surface-3)] p-3 shadow-xl shadow-black/20">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Outcomes</p>
              <p className="mt-1 text-sm text-slate-400">Pick the outcome you want to trade.</p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                aria-label="Back to markets"
                className="h-8 gap-1.5 rounded-full px-3 text-xs font-semibold"
                onClick={onClose}
                type="button"
                variant="outline"
              >
                Back
              </Button>
              {polymarketUrl ? (
                <a
                  className="inline-flex items-center gap-1 text-xs font-semibold text-cyan-600 transition hover:text-cyan-500 dark:text-cyan-200 dark:hover:text-cyan-100"
                  href={polymarketUrl}
                  rel="noreferrer"
                  target={polymarketUrl.startsWith("http") ? "_blank" : undefined}
                >
                  Polymarket
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : null}
            </div>
          </div>
          <div className="grid gap-2.5 pr-1 md:traak-scrollbar md:max-h-[min(52svh,540px)] md:overflow-y-auto md:pr-2">
            {displayMarket.outcomes.map((outcome) => {
              const selected = outcome.name === selectedOutcome?.name;
              const logoUrl = confidentOutcomeLogo(outcome, useTeamLogos ? undefined : sharedMarketLogo) ?? sharedMarketLogo;
              const participant = enrichmentParticipantsByName.get(normalizeSportsEntityName(outcome.name));
              const flag = participant?.country ? resolveCountryTeam(participant.country) : null;
              return (
                <OutcomeCard
                  key={`${displayMarket.id}-${outcome.name}`}
                  name={outcome.name}
                  price={formatCents(outcome.price)}
                  logoUrl={logoUrl}
                  flagUrl={flag ? countryFlagUrl(flag) : undefined}
                  teamDisplayName={outcome.teamDisplayName}
                  fallbackIcon={categoryMark}
                  fallbackIconSrc={categoryMarkSrc}
                  recentForm={participant?.recentForm}
                  ranking={participant?.ranking}
                  record={participant?.record}
                  oddsLabel={enrichment?.oddsComparison?.label ? enrichment.oddsComparison.label : undefined}
                  selected={selected}
                  onClick={() => setSelectedOutcomeName(outcome.name)}
                />
              );
            })}
          </div>
        </div>

        {enrichment ? (
          <div className="traak-trade-panel-section mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface-3)] p-3 text-sm shadow-xl shadow-black/10">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--muted)]">Market Insight</p>
                <p className="mt-1 font-semibold text-[var(--foreground)]">
                  {enrichment.sport.toUpperCase()} {enrichment.marketType.replace("_", " ")}
                </p>
              </div>
              <div className="flex flex-wrap justify-end gap-1.5">
                {enrichment.smartTags.slice(0, 6).map((tag) => (
                  <span key={tag} className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[11px] font-semibold text-[var(--foreground)]">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
            {enrichmentSummary ? <p className="text-sm leading-5 text-[var(--muted)]">{enrichmentSummary}</p> : null}
            {enrichment.context.injuries?.length ? (
              <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--muted)]">Injuries</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {enrichment.context.injuries.slice(0, 4).map((item) => (
                    <span key={item} className="rounded-full border border-[var(--border)] px-2.5 py-1 text-[11px] font-semibold text-[var(--foreground)]">
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            {enrichment.oddsComparison ? (
              <div className="mt-3 grid gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 sm:grid-cols-2">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--muted)]">Bookmaker Avg</p>
                  <p className="mt-1 text-base font-bold text-[var(--foreground)]">
                    {enrichment.oddsComparison.bookmakerAverageProbability !== undefined ? `${Math.round(enrichment.oddsComparison.bookmakerAverageProbability * 100)}%` : "--"}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--muted)]">Polymarket</p>
                  <p className="mt-1 text-base font-bold text-[var(--foreground)]">
                    {enrichment.oddsComparison.polymarketProbability !== undefined ? `${Math.round(enrichment.oddsComparison.polymarketProbability * 100)}%` : "--"}
                  </p>
                </div>
                <div className="sm:col-span-2">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--muted)]">Signal</p>
                  <p className="mt-1 font-semibold text-[var(--foreground)]">
                    {enrichment.oddsComparison.label === "undervalued"
                      ? "Bookmakers imply more upside than Polymarket."
                      : enrichment.oddsComparison.label === "overpriced"
                        ? "Bookmakers imply less upside than Polymarket."
                        : "Bookmakers and Polymarket are broadly aligned."}
                  </p>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        <label className="traak-trade-panel-section mt-4 block rounded-xl border border-[var(--border)] bg-[var(--surface-3)] p-3 text-sm shadow-xl shadow-black/10">
          <span className="text-[11px] uppercase tracking-[0.18em] text-[var(--muted)]">Shares</span>
          <Input
            className="mt-2 h-12 rounded-lg text-base font-semibold shadow-inner shadow-black/20"
            min="0"
            onChange={(event) => setShares(event.target.value)}
            step="1"
            type="number"
            value={shares}
          />
        </label>

        <div className="traak-trade-panel-section mt-4 divide-y divide-[var(--border)] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-3)] text-sm shadow-xl shadow-black/15">
          <div className="border-b border-[var(--border)] px-4 py-3">
            <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--muted)]">Estimate</p>
          </div>
          <EstimateRow label="Est. cost" value={Number.isFinite(buyPrice) ? `$${(safeShares * (buyPrice as number)).toFixed(2)}` : "--"} />
          <EstimateRow label="Est. proceeds" value={Number.isFinite(sellPrice) ? `$${(safeShares * (sellPrice as number)).toFixed(2)}` : "--"} accent />
        </div>

        {orderId ? (
          <div className="traak-trade-panel-section mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface-3)] p-3 text-xs text-[var(--muted)]">
            <span className="text-[var(--muted)]">Order hash/id</span>
            <p className="mt-1 break-all font-mono text-[var(--foreground)]">{orderId}</p>
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
        {enrichmentError ? <p className="mt-3 text-xs text-[var(--muted)]">{enrichmentError}</p> : null}
      </div>

      <div className="traak-trade-panel-footer border-t border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-[0_-18px_38px_rgba(0,0,0,0.4)] sm:py-3">
        <div className="grid grid-cols-2 gap-3">{actionButtons}</div>
        {tradeProgress !== "idle" ? (
          <p className="mt-2 text-[11px] uppercase tracking-[0.18em] text-cyan-600 dark:text-cyan-200">
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
        {tradeDisabledReason ? <p className="mt-2 text-[11px] leading-4 text-amber-600 dark:text-amber-200">{tradeDisabledReason}</p> : null}
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
    </>
  );
}
