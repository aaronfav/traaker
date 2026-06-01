"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowDownRight, ArrowUpRight, Clock3, Loader2, RefreshCw } from "lucide-react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatWalletAddress } from "@/src/lib/display";
import { derivePortfolioPositions, type PortfolioPosition } from "@/src/lib/positions";
import { resolveTradingWalletContext, type TradingWalletContext } from "@/lib/polymarket/tradeSetup";
import { resolveTransactionTimestamp, type Transaction, type WalletSyncStatus } from "@/src/lib/storage";

type PortfolioStateResponse = {
  transactions: Transaction[];
  connectedWallets: string[];
  walletSyncStatuses: Record<string, WalletSyncStatus>;
};

type AccountResponse = {
  ok?: boolean;
  balance?: { balance?: string; allowances?: Record<string, string> } | null;
  error?: string;
};

type LivePosition = {
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
  positions?: LivePosition[];
  error?: string;
};

type EnrichedOpenPosition = PortfolioPosition & {
  liveQuote?: number | null;
  currentValue?: number | null;
  unrealizedPnl?: number | null;
};

const toUsd = (value: number | null | undefined) => {
  if (!Number.isFinite(value ?? Number.NaN)) return "--";
  return `$${(value as number).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const toPrice = (value: number | null | undefined) => {
  if (!Number.isFinite(value ?? Number.NaN)) return "--";
  return `${Math.round((value as number) * 100)}c`;
};

const toShares = (value: number | null | undefined) => {
  if (!Number.isFinite(value ?? Number.NaN)) return "--";
  return (value as number).toLocaleString(undefined, { maximumFractionDigits: 4 });
};

function parseBalanceUsd(raw?: string | null) {
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  return parsed / 1_000_000;
}

function isPositiveAllowance(value: string | null | undefined) {
  if (!value) return false;
  try {
    return BigInt(value) > BigInt(0);
  } catch {
    return false;
  }
}

function formatDateTime(value: string | undefined) {
  if (!value) return "--";
  const normalized = resolveTransactionTimestamp({ source: "manual", timestamp: value, rawSource: undefined });
  if (!normalized) return "--";
  return new Date(normalized).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function WalletField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-slate-950/45 p-3">
      <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">{label}</p>
      <p className="mt-2 min-w-0 truncate text-sm font-medium text-slate-100" title={value}>
        {value}
      </p>
    </div>
  );
}

function PositionCard({ position }: { position: EnrichedOpenPosition }) {
  const quote = position.liveQuote ?? null;
  const currentValue = position.currentValue ?? null;
  const pnl = position.unrealizedPnl ?? null;
  const positivePnl = Number.isFinite(pnl ?? Number.NaN) ? (pnl as number) >= 0 : null;

  return (
    <div className="rounded-3xl border border-white/8 bg-slate-950/60 p-4 shadow-[0_18px_48px_rgba(2,6,23,0.22)]">
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-tight text-slate-50">{position.marketTitle}</p>
            <p className="mt-1 min-w-0 truncate text-sm text-slate-400">{position.outcome}</p>
          </div>
          <Badge tone="cyan" className="shrink-0 uppercase tracking-[0.18em]">
            Open
          </Badge>
        </div>

        <div className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-white/6 bg-white/[0.03] p-3">
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Shares</p>
            <p className="mt-2 text-base font-semibold text-slate-50">{toShares(position.shares)}</p>
          </div>
          <div className="rounded-2xl border border-white/6 bg-white/[0.03] p-3">
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Entry</p>
            <p className="mt-2 text-base font-semibold text-slate-50">{toPrice(position.price)}</p>
          </div>
          <div className="rounded-2xl border border-white/6 bg-white/[0.03] p-3">
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Quote</p>
            <p className="mt-2 text-base font-semibold text-slate-50">{toPrice(quote)}</p>
          </div>
          <div className="rounded-2xl border border-white/6 bg-white/[0.03] p-3">
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Value</p>
            <p className="mt-2 text-base font-semibold text-slate-50">{toUsd(currentValue)}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
          <span>Updated {formatDateTime(position.latestActivityTimestamp)}</span>
          <span className="inline-flex items-center gap-2">
            {positivePnl === null ? (
              <span className="text-slate-500">PnL unavailable</span>
            ) : (
              <>
                {positivePnl ? <ArrowUpRight className="h-3.5 w-3.5 text-emerald-300" /> : <ArrowDownRight className="h-3.5 w-3.5 text-rose-300" />}
                <span className={positivePnl ? "text-emerald-200" : "text-rose-200"}>{toUsd(pnl)}</span>
              </>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-950/50 p-6 text-center">
      <p className="text-base font-semibold text-slate-100">{title}</p>
      <p className="mt-2 text-sm leading-6 text-slate-400">{description}</p>
    </div>
  );
}

export default function PortfolioClient() {
  const { address, chainId, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient({ chainId: 137 });
  const publicClient = usePublicClient({ chainId: 137 });

  const [portfolioState, setPortfolioState] = useState<PortfolioStateResponse | null>(null);
  const [accountState, setAccountState] = useState<AccountResponse | null>(null);
  const [tradingContext, setTradingContext] = useState<TradingWalletContext | null>(null);
  const [livePositions, setLivePositions] = useState<LivePosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);

  const loadPortfolio = useCallback(
    async (mode: "initial" | "refresh" = "refresh") => {
      const nextWarnings: string[] = [];
      setError("");
      setWarnings([]);
      if (mode === "initial") setLoading(true);
      setRefreshing(true);

      try {
        const portfolioRequest = fetch("/api/portfolio/state", { cache: "no-store" })
          .then(async (response) => (response.ok ? ((await response.json()) as PortfolioStateResponse) : null))
          .catch(() => null);

        const walletContextPromise =
          isConnected && chainId === 137 && walletClient && publicClient && address
            ? resolveTradingWalletContext({
                walletClient,
                address,
                publicClient,
              }).catch(() => {
                nextWarnings.push("Live wallet details are unavailable until the connected wallet is ready on Polygon.");
                return null;
              })
            : Promise.resolve(null);

        const [portfolioData, resolvedTradingContext] = await Promise.all([portfolioRequest, walletContextPromise]);
        setPortfolioState(portfolioData);
        setTradingContext(resolvedTradingContext);

        const accountRequest =
          resolvedTradingContext && isConnected && chainId === 137
            ? fetch("/api/polymarket/account", { cache: "no-store" })
                .then(async (response) => {
                  const data = (await response.json().catch(() => null)) as AccountResponse | null;
                  if (!response.ok || !data?.ok) {
                    nextWarnings.push(data?.error ?? "Wallet balance is currently unavailable.");
                    return null;
                  }
                  return data;
                })
                .catch(() => {
                  nextWarnings.push("Wallet balance is currently unavailable.");
                  return null;
                })
            : Promise.resolve(null);

        const positionsRequest =
          resolvedTradingContext?.tradingWalletAddress
            ? fetch(`/api/polymarket/positions?user=${encodeURIComponent(resolvedTradingContext.tradingWalletAddress)}`, {
                cache: "no-store",
              })
                .then(async (response) => {
                  const data = (await response.json().catch(() => null)) as PositionsResponse | null;
                  if (!response.ok || !data?.ok) {
                    nextWarnings.push(data?.error ?? "Open positions are currently unavailable.");
                    return [];
                  }
                  return data.positions ?? [];
                })
                .catch(() => {
                  nextWarnings.push("Open positions are currently unavailable.");
                  return [];
                })
            : Promise.resolve([]);

        const [accountData, positionsData] = await Promise.all([accountRequest, positionsRequest]);
        setAccountState(accountData);
        setLivePositions(positionsData);
        setWarnings(nextWarnings);
        setLastUpdatedAt(Date.now());
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load portfolio data.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [address, chainId, isConnected, publicClient, walletClient],
  );

  useEffect(() => {
    void loadPortfolio("initial");
  }, [loadPortfolio]);

  const transactions = useMemo(() => portfolioState?.transactions ?? [], [portfolioState]);
  const connectedWallets = useMemo(() => portfolioState?.connectedWallets ?? [], [portfolioState]);
  const walletSyncStatuses = useMemo(() => portfolioState?.walletSyncStatuses ?? {}, [portfolioState]);
  const derivedPositions = useMemo(() => derivePortfolioPositions(transactions).openPositions, [transactions]);

  const livePositionMap = useMemo(() => {
    const map = new Map<string, LivePosition>();
    for (const position of livePositions) {
      map.set(`${position.title.trim().toLowerCase()}|${position.outcome.trim().toLowerCase()}`, position);
      map.set(position.title.trim().toLowerCase(), position);
    }
    return map;
  }, [livePositions]);

  const openPositions = useMemo<EnrichedOpenPosition[]>(() => {
    return derivedPositions
      .map((position) => {
        const live =
          livePositionMap.get(`${position.marketTitle.trim().toLowerCase()}|${position.outcome.trim().toLowerCase()}`) ??
          livePositionMap.get(position.marketTitle.trim().toLowerCase()) ??
          null;
        const quote = live?.bestBid ?? live?.curPrice ?? null;
        const currentValue = live?.currentValue ?? (Number.isFinite(quote ?? Number.NaN) ? position.shares * (quote as number) : null);
        const unrealizedPnl = Number.isFinite(currentValue ?? Number.NaN) ? (currentValue as number) - position.shares * position.price : null;
        return {
          ...position,
          liveQuote: quote,
          currentValue,
          unrealizedPnl,
        };
      })
      .sort((left, right) => {
        const leftTime = new Date(resolveTransactionTimestamp(left) ?? left.timestamp).getTime();
        const rightTime = new Date(resolveTransactionTimestamp(right) ?? right.timestamp).getTime();
        return rightTime - leftTime;
      });
  }, [derivedPositions, livePositionMap]);

  const walletBalance = parseBalanceUsd(accountState?.balance?.balance);
  const allowanceEntries = accountState?.balance?.allowances ?? {};
  const positiveAllowanceCount = Object.values(allowanceEntries).filter((value) => isPositiveAllowance(value)).length;
  const openPositionsValue = useMemo(() => {
    const values = openPositions.map((position) => position.currentValue).filter((value): value is number => Number.isFinite(value ?? Number.NaN));
    return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) : null;
  }, [openPositions]);

  const openPositionsPnl = useMemo(() => {
    const values = openPositions.map((position) => position.unrealizedPnl).filter((value): value is number => Number.isFinite(value ?? Number.NaN));
    return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) : null;
  }, [openPositions]);

  const addressSummary = useMemo(() => {
    const connected = address ? formatWalletAddress(address) : "Not connected";
    const trading = tradingContext?.tradingWalletAddress ? formatWalletAddress(tradingContext.tradingWalletAddress) : "Unavailable";
    const deposit = tradingContext?.depositWalletAddress ? formatWalletAddress(tradingContext.depositWalletAddress) : "Unavailable";
    return { connected, trading, deposit };
  }, [address, tradingContext]);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.08),transparent_32%),linear-gradient(180deg,#05070d_0%,#03040a_100%)] text-slate-100">
      <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 lg:px-8">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">Traak</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-50">Portfolio</h1>
          </div>
          <Button disabled={refreshing} onClick={() => void loadPortfolio("refresh")} size="sm" type="button" variant="secondary">
            {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh
          </Button>
        </div>

        {error ? (
          <div className="mb-4 flex gap-3 rounded-2xl border border-rose-400/25 bg-rose-950/35 p-4 text-sm text-rose-100">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        {warnings.length > 0 ? (
          <div className="mb-4 rounded-2xl border border-amber-400/20 bg-amber-950/25 p-4 text-sm text-amber-100">
            <p className="font-medium">Some portfolio data is still loading.</p>
            <ul className="mt-2 space-y-1 text-amber-50/85">
              {warnings.map((warning) => (
                <li key={warning} className="flex gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300" />
                  <span>{warning}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.92fr)]">
          <Card className="border-white/8 bg-[linear-gradient(180deg,rgba(15,23,42,0.95),rgba(2,6,23,0.98))] shadow-[0_24px_90px_rgba(2,6,23,0.3)]">
            <CardHeader className="border-b border-white/6 px-5 py-4">
              <CardTitle className="text-base font-semibold text-slate-50">Positions</CardTitle>
              <CardDescription className="mt-1 text-sm text-slate-400">Open positions with live marks when available.</CardDescription>
            </CardHeader>
            <CardContent className="p-5">
              {loading && transactions.length === 0 ? (
                <div className="flex items-center gap-3 rounded-2xl border border-white/8 bg-slate-950/50 p-5 text-sm text-slate-300">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading portfolio
                </div>
              ) : openPositions.length > 0 ? (
                <div className="space-y-3">
                  {openPositions.map((position) => (
                    <PositionCard key={position.positionKey} position={position} />
                  ))}
                </div>
              ) : (
                <EmptyState title="No open positions yet" description="Open positions will appear here after imported wallet activity or manual records create exposure." />
              )}
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card className="border-white/8 bg-[linear-gradient(180deg,rgba(15,23,42,0.95),rgba(2,6,23,0.98))] shadow-[0_24px_90px_rgba(2,6,23,0.3)]">
              <CardHeader className="border-b border-white/6 px-5 py-4">
                <CardTitle className="text-base font-semibold text-slate-50">Wallet</CardTitle>
                <CardDescription className="mt-1 text-sm text-slate-400">Balances and wallet addresses for trading and sync.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 p-5">
                <div className="grid gap-3 sm:grid-cols-2">
                  <WalletField label="Connected wallet" value={addressSummary.connected} />
                  <WalletField label="Trading wallet" value={addressSummary.trading} />
                  <WalletField label="Deposit wallet" value={addressSummary.deposit} />
                  <div className="rounded-2xl border border-white/8 bg-slate-950/45 p-3">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Allowances</p>
                    <p className="mt-2 text-sm font-medium text-slate-100">
                      {positiveAllowanceCount > 0 ? `${positiveAllowanceCount} active allowance${positiveAllowanceCount === 1 ? "" : "s"}` : "No live allowances loaded"}
                    </p>
                  </div>
                </div>

                <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Wallet balance</p>
                      <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-50">{toUsd(walletBalance)}</p>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-slate-400">
                      <Clock3 className="h-4 w-4" />
                      <span>{lastUpdatedAt ? `Updated ${new Date(lastUpdatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Waiting for refresh"}</span>
                    </div>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-400">
                    {walletBalance === null
                      ? "Connect and refresh to load the live wallet balance."
                      : "This is the live USDC balance used for trading readiness checks."}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <Link href="/portfolio/connect" className="rounded-full border border-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/5">
                    Manage wallets
                  </Link>
                  <span className="text-xs uppercase tracking-[0.2em] text-slate-500">Withdraw only if already supported elsewhere</span>
                </div>

                <div className="text-xs text-slate-500">
                  {isConnected ? (
                    <span>Connected wallet: {addressSummary.connected}</span>
                  ) : (
                    <span>Connect a wallet to view balances and trading wallets.</span>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="border-white/8 bg-[linear-gradient(180deg,rgba(15,23,42,0.95),rgba(2,6,23,0.98))] shadow-[0_24px_90px_rgba(2,6,23,0.3)]">
              <CardHeader className="border-b border-white/6 px-5 py-4">
                <CardTitle className="text-base font-semibold text-slate-50">Wallet sync</CardTitle>
                <CardDescription className="mt-1 text-sm text-slate-400">Imported wallet states and recent syncs.</CardDescription>
              </CardHeader>
              <CardContent className="p-5">
                {connectedWallets.length > 0 ? (
                  <div className="space-y-3">
                    {connectedWallets.map((wallet) => {
                      const status = walletSyncStatuses[wallet];
                      return (
                        <div key={wallet} className="rounded-2xl border border-white/8 bg-slate-950/50 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-slate-100" title={wallet}>
                                {formatWalletAddress(wallet)}
                              </p>
                              <p className="mt-1 text-xs text-slate-500" title={wallet}>
                                {wallet}
                              </p>
                            </div>
                            <Badge tone={status ? "green" : "slate"}>{status ? "Synced" : "Connected"}</Badge>
                          </div>
                          {status ? (
                            <div className="mt-3 grid gap-2 text-sm text-slate-400 sm:grid-cols-3">
                              <span>Imported {status.tradesImported} trades</span>
                              <span>Found {status.tradesFound} trades</span>
                              <span>{new Date(status.lastSyncedAt).toLocaleDateString()}</span>
                            </div>
                          ) : (
                            <p className="mt-3 text-sm text-slate-400">This wallet is connected but has not been synced yet.</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <EmptyState
                    title="No connected wallets"
                    description="Connect a wallet to track imported trades and keep the portfolio synced."
                  />
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-white/6 bg-slate-950/40 p-4 text-sm text-slate-400">
          Open positions: {openPositions.length} · Positions value: {toUsd(openPositionsValue)} · Unrealized P&L: {openPositionsPnl === null ? "--" : toUsd(openPositionsPnl)}
        </div>
      </div>
    </main>
  );
}
