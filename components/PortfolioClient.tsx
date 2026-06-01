"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowDownRight, ArrowUpRight, CheckCircle2, Clock3, Loader2, RefreshCw, X } from "lucide-react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatWalletAddress } from "@/src/lib/display";
import { derivePortfolioPositions, type PortfolioPosition } from "@/src/lib/positions";
import { resolveTradingWalletContext, type TradingWalletContext } from "@/lib/polymarket/tradeSetup";
import { withdrawFromTradingWallet } from "@/lib/polymarket/withdraw";
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

function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="rounded-3xl border border-white/6 bg-slate-950/35 px-5 py-7 text-center shadow-[0_12px_36px_rgba(2,6,23,0.14)]">
      <p className="text-base font-semibold text-slate-100">{title}</p>
      {description ? <p className="mt-2 text-sm leading-6 text-slate-400">{description}</p> : null}
    </div>
  );
}

type WithdrawModalProps = {
  open: boolean;
  availableBalance: number | null;
  destinationAddress: string;
  amount: string;
  error: string;
  success: string;
  withdrawing: boolean;
  canSubmit: boolean;
  onClose: () => void;
  onAmountChange: (value: string) => void;
  onDestinationChange: (value: string) => void;
  onSubmit: () => void;
};

function WithdrawModal({
  open,
  availableBalance,
  destinationAddress,
  amount,
  error,
  success,
  withdrawing,
  canSubmit,
  onClose,
  onAmountChange,
  onDestinationChange,
  onSubmit,
}: WithdrawModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md">
      <div className="flex min-h-full items-end justify-center p-3 sm:items-center sm:p-5">
        <div className="w-full max-w-xl overflow-hidden rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.98),rgba(2,6,23,0.99))] shadow-[0_30px_120px_rgba(2,6,23,0.72)] max-h-[calc(100vh-1.5rem)] overflow-y-auto">
          <div className="flex items-start justify-between gap-4 border-b border-white/8 px-5 py-4 sm:px-6">
            <div>
              <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">Wallet withdrawal</p>
              <h2 className="mt-1 text-lg font-semibold text-slate-50">Withdraw funds</h2>
              <p className="mt-1 text-sm text-slate-400">Move available USDC from your trading wallet to another wallet address.</p>
            </div>
            <Button aria-label="Close withdraw dialog" onClick={onClose} size="icon" type="button" variant="ghost">
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="space-y-4 px-5 py-5 sm:px-6">
            <div className="rounded-3xl border border-white/8 bg-white/[0.03] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Available balance</p>
                  <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-50">
                    {availableBalance === null ? "--" : `$${availableBalance.toFixed(2)}`}
                  </p>
                </div>
                <Badge tone={availableBalance && availableBalance > 0 ? "green" : "slate"} className="uppercase tracking-[0.18em]">
                  {availableBalance && availableBalance > 0 ? "Ready" : "No balance"}
                </Badge>
              </div>
            </div>

            {success ? (
              <div className="flex gap-3 rounded-3xl border border-emerald-400/20 bg-emerald-500/10 p-4 text-emerald-100">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium">{success}</p>
                  <p className="mt-1 text-sm text-emerald-100/75">You can close this dialog and refresh the portfolio if needed.</p>
                </div>
              </div>
            ) : null}

            {error ? (
              <div className="flex gap-3 rounded-3xl border border-rose-400/20 bg-rose-500/10 p-4 text-rose-100">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <p className="text-sm">{error}</p>
              </div>
            ) : null}

            <div className="space-y-3">
              <div>
                <label className="mb-1.5 block text-[11px] uppercase tracking-[0.2em] text-slate-500" htmlFor="withdraw-amount">
                  Amount
                </label>
                <Input
                  id="withdraw-amount"
                  inputMode="decimal"
                  onChange={(event) => onAmountChange(event.target.value)}
                  placeholder="0.00"
                  value={amount}
                />
              </div>

              <div>
                <label className="mb-1.5 block text-[11px] uppercase tracking-[0.2em] text-slate-500" htmlFor="withdraw-destination">
                  Destination wallet
                </label>
                <Input
                  id="withdraw-destination"
                  onChange={(event) => onDestinationChange(event.target.value)}
                  placeholder="0x..."
                  value={destinationAddress}
                />
                <p className="mt-2 text-xs leading-5 text-slate-500">Funds are sent directly to the address you enter.</p>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-white/8 px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
            <Button onClick={onClose} type="button" variant="outline">
              Cancel
            </Button>
            <Button disabled={success ? false : !canSubmit || withdrawing} onClick={success ? onClose : onSubmit} type="button">
              {withdrawing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {success ? "Done" : "Confirm withdraw"}
            </Button>
          </div>
        </div>
      </div>
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
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawDestination, setWithdrawDestination] = useState("");
  const [withdrawError, setWithdrawError] = useState("");
  const [withdrawSuccess, setWithdrawSuccess] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);

  const loadPortfolio = useCallback(
    async (mode: "initial" | "refresh" = "refresh") => {
      setError("");
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
              }).catch(() => null)
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
                    return null;
                  }
                  return data;
                })
                .catch(() => null)
            : Promise.resolve(null);

        const positionsRequest =
          resolvedTradingContext?.tradingWalletAddress
            ? fetch(`/api/polymarket/positions?user=${encodeURIComponent(resolvedTradingContext.tradingWalletAddress)}`, {
                cache: "no-store",
              })
                .then(async (response) => {
                  const data = (await response.json().catch(() => null)) as PositionsResponse | null;
                  if (!response.ok || !data?.ok) {
                    return [];
                  }
                  return data.positions ?? [];
                })
                .catch(() => [])
            : Promise.resolve([]);

        const [accountData, positionsData] = await Promise.all([accountRequest, positionsRequest]);
        setAccountState(accountData);
        setLivePositions(positionsData);
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
  const addressSummary = useMemo(() => {
    const connected = address ? formatWalletAddress(address) : "Not connected";
    const trading = tradingContext?.tradingWalletAddress ? formatWalletAddress(tradingContext.tradingWalletAddress) : "Unavailable";
    const deposit = tradingContext?.depositWalletAddress ? formatWalletAddress(tradingContext.depositWalletAddress) : "Unavailable";
    return { connected, trading, deposit };
  }, [address, tradingContext]);

  useEffect(() => {
    if (!withdrawOpen) {
      return;
    }
    setWithdrawDestination(address ?? "");
  }, [address, withdrawOpen]);

  const closeWithdrawModal = useCallback(() => {
    setWithdrawOpen(false);
    setWithdrawAmount("");
    setWithdrawDestination("");
    setWithdrawError("");
    setWithdrawSuccess("");
    setWithdrawing(false);
  }, []);

  const openWithdrawModal = useCallback(() => {
    setWithdrawError("");
    setWithdrawSuccess("");
    setWithdrawAmount("");
    setWithdrawDestination(address ?? "");
    setWithdrawOpen(true);
  }, [address]);

  const handleWithdraw = useCallback(async () => {
    if (!isConnected || chainId !== 137 || !walletClient || !publicClient || !address) {
      setWithdrawError("Connect a Polygon wallet before withdrawing.");
      return;
    }
    if (!tradingContext?.tradingWalletAddress) {
      setWithdrawError("Trading wallet unavailable.");
      return;
    }
    if (walletBalance === null) {
      setWithdrawError("Wallet balance is not loaded yet.");
      return;
    }

    setWithdrawError("");
    setWithdrawSuccess("");
    setWithdrawing(true);

    try {
      const result = await withdrawFromTradingWallet({
        walletClient,
        publicClient,
        address,
        destinationAddress: withdrawDestination.trim(),
        amount: withdrawAmount.trim(),
        availableBalanceRaw: accountState?.balance?.balance ?? null,
      });
      setWithdrawSuccess(`Withdrawal submitted to ${formatWalletAddress(result.destinationAddress)}.`);
      await loadPortfolio("refresh");
    } catch (err) {
      setWithdrawError(err instanceof Error ? err.message : "Unable to withdraw funds.");
    } finally {
      setWithdrawing(false);
    }
  }, [
    accountState?.balance?.balance,
    address,
    chainId,
    isConnected,
    loadPortfolio,
    publicClient,
    tradingContext?.tradingWalletAddress,
    walletBalance,
    walletClient,
    withdrawAmount,
    withdrawDestination,
  ]);

  const canSubmitWithdraw = useMemo(() => {
    if (withdrawing) return false;
    if (!withdrawAmount.trim() || !withdrawDestination.trim()) return false;
    if (!isConnected || chainId !== 137 || !walletClient || !publicClient || !address) return false;
    if (!tradingContext?.tradingWalletAddress) return false;
    return true;
  }, [
    address,
    chainId,
    isConnected,
    publicClient,
    tradingContext?.tradingWalletAddress,
    walletClient,
    withdrawAmount,
    withdrawDestination,
    withdrawing,
  ]);

  const canOpenWithdraw = Boolean(
    isConnected &&
      chainId === 137 &&
      walletClient &&
      publicClient &&
      address &&
      tradingContext?.tradingWalletAddress &&
      walletBalance !== null &&
      walletBalance > 0,
  );

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
                <EmptyState title="No open positions" />
              )}
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card className="border-white/8 bg-[linear-gradient(180deg,rgba(15,23,42,0.95),rgba(2,6,23,0.98))] shadow-[0_24px_90px_rgba(2,6,23,0.3)]">
              <CardHeader className="border-b border-white/6 px-5 py-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <CardTitle className="text-base font-semibold text-slate-50">Wallet</CardTitle>
                    <CardDescription className="mt-1 text-sm text-slate-400">Balances and wallet addresses used for trading.</CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={isConnected ? "green" : "slate"} className="uppercase tracking-[0.18em]">
                      {isConnected ? "Connected" : "Disconnected"}
                    </Badge>
                    <Button disabled={!canOpenWithdraw} onClick={openWithdrawModal} size="sm" type="button" variant="outline">
                      Withdraw
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 p-5">
                <div className="grid gap-3 sm:grid-cols-2">
                  <WalletField label="Connected wallet" value={addressSummary.connected} />
                  <WalletField label="Trading wallet" value={addressSummary.trading} />
                  <WalletField label="Deposit wallet" value={addressSummary.deposit} />
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
                      : "This is the live USDC balance available for withdrawals and trading."}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
        <WithdrawModal
          amount={withdrawAmount}
          availableBalance={walletBalance}
          canSubmit={canSubmitWithdraw}
          destinationAddress={withdrawDestination}
          error={withdrawError}
          onAmountChange={setWithdrawAmount}
          onClose={closeWithdrawModal}
          onDestinationChange={setWithdrawDestination}
          onSubmit={handleWithdraw}
          open={withdrawOpen}
          success={withdrawSuccess}
          withdrawing={withdrawing}
        />
      </div>
    </main>
  );
}
