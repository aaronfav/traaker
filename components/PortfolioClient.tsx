"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, RefreshCw, X } from "lucide-react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createSignerClient, SignatureTypeV2 } from "@/lib/polymarket/client";
import { OrderType, placeMarketOrder, Side, isDepositWalletRequiredError } from "@/lib/polymarket/orders";
import { ensureTradingReady, markDepositWalletRequired, resolveTradingWalletContext, type TradeProgress } from "@/lib/polymarket/tradeSetup";
import type { Address } from "viem";

const DEFAULT_SLIPPAGE_BPS = 300;

type AvailablePosition = {
  tokenId: string;
  conditionId: string;
  title: string;
  outcome: string;
  shares: number;
  avgPrice: number | null;
  currentValue: number | null;
  curPrice: number | null;
  bestBid: number | null;
  negativeRisk: boolean;
};

type PositionsResponse = {
  ok?: boolean;
  positions?: AvailablePosition[];
  error?: string;
};

type SellState = {
  position: AvailablePosition;
  amount: string;
};

function formatCurrency(value: number | null | undefined) {
  if (!Number.isFinite(value ?? Number.NaN)) return "--";
  return `$${(value as number).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatShares(value: number) {
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function formatCents(value: number | null | undefined) {
  if (!Number.isFinite(value ?? Number.NaN)) return "--";
  return `${Math.round((value as number) * 100)}c`;
}

function getOrderStatus(response: unknown) {
  const root = response && typeof response === "object" ? (response as Record<string, unknown>) : {};
  const data = root.data && typeof root.data === "object" ? (root.data as Record<string, unknown>) : root;
  const status = typeof data.status === "string" ? data.status : "";
  const tradeIDs = Array.isArray(data.tradeIDs) ? data.tradeIDs.length : 0;
  if (tradeIDs > 0) return `${status || "matched"} (${tradeIDs} fill${tradeIDs === 1 ? "" : "s"})`;
  return status || "submitted";
}

export default function PortfolioClient() {
  const { address, chainId, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient({ chainId: 137 });
  const publicClient = usePublicClient({ chainId: 137 });
  const [positions, setPositions] = useState<AvailablePosition[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sellState, setSellState] = useState<SellState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [tradeProgress, setTradeProgress] = useState<TradeProgress>("idle");

  const sellablePositions = useMemo(
    () => positions.filter((position) => Number.isFinite(position.shares) && position.shares > 0),
    [positions],
  );

  const loadPositions = useCallback(
    async (mode: "initial" | "refresh" = "refresh") => {
      setError("");
      setNotice("");
      if (!isConnected || !walletClient || !address) {
        setPositions([]);
        setNotice("Connect a wallet to view available trades.");
        return;
      }
      if (chainId !== 137) {
        setPositions([]);
        setNotice("Switch to Polygon mainnet to view available trades.");
        return;
      }
      if (!publicClient) {
        setPositions([]);
        setError("Polygon client is unavailable.");
        return;
      }

      if (mode === "initial") setLoading(true);
      setRefreshing(true);
      try {
        const context = await resolveTradingWalletContext({
          walletClient,
          address: address as Address,
          publicClient,
        });
        const params = new URLSearchParams({ user: context.tradingWalletAddress });
        const response = await fetch(`/api/polymarket/positions?${params.toString()}`, { cache: "no-store" });
        const data = (await response.json().catch(() => null)) as PositionsResponse | null;
        if (!response.ok || !data?.ok) {
          throw new Error(data?.error ?? "Unable to load available trades.");
        }
        setPositions((data.positions ?? []).filter((position) => position.shares > 0));
      } catch (err) {
        setPositions([]);
        setError(err instanceof Error ? err.message : "Unable to load available trades.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [address, chainId, isConnected, publicClient, walletClient],
  );

  useEffect(() => {
    void loadPositions("initial");
  }, [loadPositions]);

  const selectedAmount = Number(sellState?.amount ?? 0);
  const selectedBid = sellState?.position.bestBid ?? sellState?.position.curPrice ?? null;
  const estimatedProceeds = Number.isFinite(selectedAmount) && Number.isFinite(selectedBid ?? Number.NaN)
    ? selectedAmount * (selectedBid as number)
    : null;

  async function submitSell() {
    if (!sellState || submitting) return;
    const amount = Number(sellState.amount);
    const position = sellState.position;
    const price = position.bestBid ?? position.curPrice;

    setError("");
    setNotice("");

    if (!isConnected || !walletClient || !address) {
      setError("Connect a wallet before selling.");
      return;
    }
    if (chainId !== 137) {
      setError("Switch to Polygon mainnet before selling.");
      return;
    }
    if (!publicClient) {
      setError("Polygon client is unavailable.");
      return;
    }
    if (!position.tokenId) {
      setError("This position is missing a CLOB token id.");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Enter a share amount greater than 0.");
      return;
    }
    if (amount > position.shares) {
      setError("Sell amount cannot exceed available shares.");
      return;
    }
    if (!Number.isFinite(price ?? Number.NaN) || (price as number) <= 0) {
      setError("No sell quote is available for this position.");
      return;
    }

    const submitOnce = async (forceDepositWallet = false) => {
      if (forceDepositWallet && address) {
        markDepositWalletRequired(address as string);
      }
      const setup = await ensureTradingReady({
        walletClient,
        address: address as Address,
        publicClient,
        side: "Sell",
        tokenId: position.tokenId,
        amount,
        price: price as number,
        negRisk: position.negativeRisk,
        onProgress: setTradeProgress,
      });
      const client = await createSignerClient({
        signer: walletClient,
        signatureType: setup.signatureType === 2 ? SignatureTypeV2.POLY_GNOSIS_SAFE : SignatureTypeV2.POLY_1271,
        funderAddress: setup.tradingWalletAddress,
      });
      setTradeProgress("submitting-order");
      return placeMarketOrder(client, {
        tokenID: position.tokenId,
        amount,
        currentPrice: price as number,
        maxSlippageBps: DEFAULT_SLIPPAGE_BPS,
        side: Side.SELL,
        orderType: OrderType.FAK,
        negRisk: position.negativeRisk,
      });
    };

    setSubmitting(true);
    setTradeProgress("checking-wallet");
    try {
      const response = await submitOnce(false);
      setNotice(`Sell order ${getOrderStatus(response)}.`);
      setSellState(null);
      await loadPositions("refresh");
    } catch (err) {
      if (!isDepositWalletRequiredError(err) || !address) {
        setError(err instanceof Error ? err.message : "Unable to submit sell order.");
        return;
      }
      try {
        setTradeProgress("initializing-trading-wallet");
        const response = await submitOnce(true);
        setNotice(`Sell order ${getOrderStatus(response)}.`);
        setSellState(null);
        await loadPositions("refresh");
      } catch (retryErr) {
        setError(retryErr instanceof Error ? retryErr.message : "Unable to submit sell order.");
      }
    } finally {
      setSubmitting(false);
      setTradeProgress("idle");
    }
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[#05070d]">
      <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-50 sm:text-3xl">Available Trades</h1>
          <Button disabled={refreshing} onClick={() => void loadPositions("refresh")} size="sm" type="button" variant="secondary">
            {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh
          </Button>
        </div>

        {error ? (
          <div className="mb-4 flex gap-3 rounded-lg border border-rose-400/30 bg-rose-950/30 p-3 text-sm text-rose-100">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        {notice ? (
          <div className="mb-4 flex gap-3 rounded-lg border border-cyan-400/25 bg-cyan-950/25 p-3 text-sm text-cyan-100">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{notice}</span>
          </div>
        ) : null}

        {loading ? (
          <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-5 text-sm text-slate-300">
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading available trades
            </span>
          </div>
        ) : sellablePositions.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-800 bg-slate-950/45 px-4 py-10 text-center text-sm font-medium text-slate-300">
            No available trades to sell.
          </div>
        ) : (
          <section className="space-y-3">
            {sellablePositions.map((position) => {
              const quote = position.bestBid ?? position.curPrice;
              const estimatedValue = position.bestBid != null ? position.shares * position.bestBid : position.currentValue;
              return (
                <article className="rounded-lg border border-slate-800 bg-slate-950/72 p-4 shadow-lg shadow-black/15" key={`${position.conditionId}-${position.tokenId}`}>
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <h2 className="line-clamp-2 text-base font-semibold leading-snug text-slate-50">{position.title}</h2>
                      <div className="mt-3 grid gap-2 text-sm text-slate-400 sm:grid-cols-3">
                        <span>
                          Outcome <strong className="font-semibold text-slate-100">{position.outcome}</strong>
                        </span>
                        <span>
                          Shares <strong className="font-semibold text-slate-100">{formatShares(position.shares)}</strong>
                        </span>
                        <span>
                          {quote != null ? "Best bid" : "Est. value"}{" "}
                          <strong className="font-semibold text-slate-100">
                            {quote != null ? formatCents(quote) : formatCurrency(estimatedValue)}
                          </strong>
                        </span>
                      </div>
                    </div>
                    <Button
                      className="w-full bg-rose-400 text-slate-950 hover:bg-rose-300 sm:w-auto"
                      disabled={!position.tokenId || quote == null}
                      onClick={() => setSellState({ position, amount: String(position.shares) })}
                      type="button"
                    >
                      Sell
                    </Button>
                  </div>
                </article>
              );
            })}
          </section>
        )}
      </div>

      {sellState ? (
        <div className="fixed inset-0 z-50 flex items-end bg-black/70 p-3 sm:items-center sm:justify-center">
          <div className="w-full max-w-md rounded-lg border border-slate-800 bg-[#07080b] p-4 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-slate-50">Sell shares</h2>
                <p className="mt-1 line-clamp-2 text-sm text-slate-400">{sellState.position.title}</p>
              </div>
              <Button aria-label="Close sell form" className="h-8 w-8" disabled={submitting} onClick={() => setSellState(null)} size="icon" type="button" variant="ghost">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="mt-4 space-y-4">
              <div className="rounded-lg border border-slate-800 bg-black/25 p-3 text-sm text-slate-300">
                <div className="flex justify-between gap-3">
                  <span>Outcome</span>
                  <span className="font-semibold text-slate-100">{sellState.position.outcome}</span>
                </div>
                <div className="mt-2 flex justify-between gap-3">
                  <span>Best bid</span>
                  <span className="font-semibold text-slate-100">{formatCents(selectedBid)}</span>
                </div>
                <div className="mt-2 flex justify-between gap-3">
                  <span>Estimated proceeds</span>
                  <span className="font-semibold text-slate-100">{formatCurrency(estimatedProceeds)}</span>
                </div>
              </div>

              <label className="block text-sm">
                <span className="text-slate-300">Shares to sell</span>
                <Input
                  className="mt-2 border-slate-800 bg-black text-base font-semibold text-slate-50"
                  disabled={submitting}
                  max={sellState.position.shares}
                  min="0"
                  onChange={(event) => setSellState((current) => (current ? { ...current, amount: event.target.value } : current))}
                  step="0.0001"
                  type="number"
                  value={sellState.amount}
                />
                <span className="mt-1 block text-xs text-slate-500">Max {formatShares(sellState.position.shares)} shares</span>
              </label>

              {tradeProgress !== "idle" ? (
                <p className="text-xs uppercase tracking-[0.18em] text-cyan-200">
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

              <Button className="w-full bg-rose-400 text-slate-950 hover:bg-rose-300" disabled={submitting} onClick={() => void submitSell()} type="button">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Confirm Sell
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
