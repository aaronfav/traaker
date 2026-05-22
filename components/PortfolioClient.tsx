"use client";

import { useEffect, useState } from "react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { Activity, AlertTriangle, Clock, Info, Loader2, RefreshCw, Wallet, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cancelOrder } from "@/lib/polymarket/orders";
import { getDepositWalletStatus } from "@/lib/polymarket/depositWallet";
import { getPnLPlaceholder, getPositions } from "@/lib/polymarket/portfolio";
import type { PortfolioBalanceState, Position } from "@/lib/polymarket/types";
import type { OpenOrder } from "@polymarket/clob-client-v2";
import type { Address } from "viem";

const emptyBalance: PortfolioBalanceState = {
  usdc: {
    balance: 0,
    rawBalance: "0",
    allowances: {},
    exchangeAllowance: null,
    ctfAllowance: null,
    hasExchangeAllowance: false,
    hasCtfAllowance: false,
  },
  pUsd: null,
  conditional: null,
  source: "mock",
};

function formatAddress(value?: string) {
  if (!value) return "Not connected";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function formatCurrency(value: number) {
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

function DashboardMetric({
  label,
  value,
  detail,
  tone = "slate",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "slate" | "green" | "amber" | "rose" | "cyan";
}) {
  const toneClass = {
    slate: "text-slate-50",
    green: "text-emerald-200",
    amber: "text-amber-200",
    rose: "text-rose-200",
    cyan: "text-cyan-100",
  }[tone];

  return (
    <Card className="border-slate-800/90 bg-slate-950/72 shadow-xl shadow-black/15">
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</p>
        <p className={`mt-3 text-2xl font-semibold tracking-tight ${toneClass}`}>{value}</p>
        <p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p>
      </CardContent>
    </Card>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-800 bg-slate-950/45 px-4 py-8 text-center">
      <p className="text-sm font-semibold text-slate-200">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-slate-500">{detail}</p>
    </div>
  );
}

export default function PortfolioClient() {
  const { address, chainId, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient({ chainId: 137 });
  const publicClient = usePublicClient({ chainId: 137 });
  const [loading, setLoading] = useState(false);
  const [balance, setBalance] = useState<PortfolioBalanceState>(emptyBalance);
  const [positions, setPositions] = useState<Position[]>([]);
  const [openOrders, setOpenOrders] = useState<OpenOrder[]>([]);
  const [trades, setTrades] = useState<unknown[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [depositWallet, setDepositWallet] = useState<{ depositWallet: string; initialized: boolean } | null>(null);
  const [cancellingOrderId, setCancellingOrderId] = useState("");

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError("");
      setNotice("");

      try {
        const fallbackPositions = await getPositions();

        if (!walletClient || !isConnected || chainId !== 137) {
          if (!active) return;
          setPositions(fallbackPositions);
          setBalance(emptyBalance);
          setOpenOrders([]);
          setTrades([]);
          setDepositWallet(null);
          return;
        }

        const walletStatus = await getDepositWalletStatus(address as Address, publicClient);
        if (!active) return;
        setDepositWallet(walletStatus);
        if (!walletStatus.initialized) {
          setBalance(emptyBalance);
          setPositions(fallbackPositions);
          setOpenOrders([]);
          setTrades([]);
          setError("");
          setNotice("Trading wallet will initialize from the Markets trade flow when needed.");
          return;
        }

        const configResponse = await fetch("/api/polymarket/config", { cache: "no-store" });
        const configData = await configResponse.json().catch(() => null);
        if (!configResponse.ok || !configData?.ok) {
          setBalance(emptyBalance);
          setPositions(fallbackPositions);
          setOpenOrders([]);
          setTrades([]);
          setError("");
          setNotice((configData?.error as string | undefined) ?? "Trading configuration is unavailable.");
          return;
        }
        if (!configData.clobReady) {
          setBalance(emptyBalance);
          setPositions(fallbackPositions);
          setOpenOrders([]);
          setTrades([]);
          setError("");
          setNotice(configData.missingSetupReason ?? "Trading configuration is unavailable.");
          return;
        }

        const accountResponse = await fetch("/api/polymarket/account", { cache: "no-store" });
        const accountData = await accountResponse.json().catch(() => null);
        if (!accountResponse.ok || !accountData?.ok) {
          if (accountData?.code === "AUTH_INVALID_SESSION") {
            setBalance(emptyBalance);
            setPositions(fallbackPositions);
            setOpenOrders([]);
            setTrades([]);
            setError("");
            setNotice("Polymarket session expired. Reinitializing trading session.");
            return;
          }
          throw new Error(accountData?.error ?? "Unable to load Polymarket account data.");
        }

        if (!active) return;
        setBalance({
          usdc: {
            balance: Number(accountData.balance?.balance ?? 0) / 1_000_000,
            rawBalance: String(accountData.balance?.balance ?? "0"),
            allowances: accountData.balance?.allowances ?? {},
            exchangeAllowance: (Object.values(accountData.balance?.allowances ?? {})[0] as string | undefined) ?? null,
            ctfAllowance: (Object.values(accountData.balance?.allowances ?? {})[1] as string | undefined) ?? null,
            hasExchangeAllowance: Boolean(Object.values(accountData.balance?.allowances ?? {})[0]),
            hasCtfAllowance: Boolean(Object.values(accountData.balance?.allowances ?? {})[1]),
          },
          pUsd: null,
          conditional: null,
          source: "polymarket",
        });
        setPositions(fallbackPositions);
        setOpenOrders(Array.isArray(accountData.openOrders) ? accountData.openOrders : []);
        setTrades(Array.isArray(accountData.trades) ? accountData.trades : []);
        setError("");
        setNotice("");
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Unable to load portfolio.");
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [address, chainId, isConnected, publicClient, walletClient]);

  const pnl = getPnLPlaceholder(positions);
  const positionsBySport = positions.reduce<Record<string, Position[]>>((groups, position) => {
    const text = position.market.toLowerCase();
    const sport = text.includes("nba") || text.includes("basketball")
      ? "Basketball"
      : text.includes("nfl") || text.includes("football")
        ? "Football"
        : text.includes("soccer") || text.includes("league")
          ? "Soccer"
          : text.includes("ufc")
            ? "UFC"
            : "Other";
    groups[sport] = [...(groups[sport] ?? []), position];
    return groups;
  }, {});
  const totalPositionValue = positions.reduce((sum, position) => sum + position.value, 0);
  const walletReady = isConnected && chainId === 137;
  const depositWalletReady = depositWallet?.initialized ?? false;
  const balanceReady = balance.source === "polymarket" && balance.usdc.balance > 0;
  const allowanceReady = balance.source === "polymarket" && balance.usdc.hasExchangeAllowance && balance.usdc.hasCtfAllowance;
  const accountReady = walletReady && depositWalletReady && balanceReady && allowanceReady && error === "";
  const walletStatusText = isConnected ? (chainId === 137 ? "Polygon connected" : "Wrong network") : "Wallet disconnected";
  const accountStatusDetail = accountReady
    ? "Balances and allowances are ready"
    : walletReady
      ? "Trading setup still needs attention"
      : "Connect on Polygon to load live data";

  async function refreshPortfolio() {
    if (!isConnected || chainId !== 137) return;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const walletStatus = await getDepositWalletStatus(address as Address, publicClient);
      setDepositWallet(walletStatus);
      if (!walletStatus.initialized) {
        setBalance(emptyBalance);
        setOpenOrders([]);
        setTrades([]);
        setPositions(await getPositions());
        setNotice("Trading wallet will initialize from the Markets trade flow when needed.");
        return;
      }

      const configResponse = await fetch("/api/polymarket/config", { cache: "no-store" });
      const configData = await configResponse.json().catch(() => null);
      if (!configResponse.ok || !configData?.ok) {
        setBalance(emptyBalance);
        setOpenOrders([]);
        setTrades([]);
        setPositions(await getPositions());
        setError("");
        setNotice((configData?.error as string | undefined) ?? "Trading configuration is unavailable.");
        return;
      }
      if (!configData.clobReady) {
        setBalance(emptyBalance);
        setOpenOrders([]);
        setTrades([]);
        setPositions(await getPositions());
        setError("");
        setNotice(configData.missingSetupReason ?? "Trading configuration is unavailable.");
        return;
      }

      const accountResponse = await fetch("/api/polymarket/account", { cache: "no-store" });
      const accountData = await accountResponse.json().catch(() => null);
        if (!accountResponse.ok || !accountData?.ok) {
          if (accountData?.code === "AUTH_INVALID_SESSION") {
            setBalance(emptyBalance);
            setOpenOrders([]);
            setTrades([]);
            setPositions(await getPositions());
            setError("");
            setNotice("Polymarket session expired. Reinitializing trading session.");
            return;
          }
        throw new Error(accountData?.error ?? "Unable to load Polymarket account data.");
      }
      setBalance({
        usdc: {
          balance: Number(accountData.balance?.balance ?? 0) / 1_000_000,
          rawBalance: String(accountData.balance?.balance ?? "0"),
          allowances: accountData.balance?.allowances ?? {},
          exchangeAllowance: Object.values(accountData.balance?.allowances ?? {})[0] as string | null ?? null,
          ctfAllowance: Object.values(accountData.balance?.allowances ?? {})[1] as string | null ?? null,
          hasExchangeAllowance: Boolean(Object.values(accountData.balance?.allowances ?? {})[0]),
          hasCtfAllowance: Boolean(Object.values(accountData.balance?.allowances ?? {})[1]),
        },
        pUsd: null,
        conditional: null,
        source: "polymarket",
      });
      setOpenOrders(Array.isArray(accountData.openOrders) ? accountData.openOrders : []);
      setTrades(Array.isArray(accountData.trades) ? accountData.trades : []);
      setPositions(await getPositions());
      setError("");
      setNotice("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to refresh portfolio.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCancel(orderId: string) {
    if (!depositWallet) return;
    setCancellingOrderId(orderId);
    setError("");
    setNotice("");
    try {
      await cancelOrder(orderId);
      await refreshPortfolio();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to cancel order.");
    } finally {
      setCancellingOrderId("");
    }
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[#05070d]">
      <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm uppercase tracking-[0.24em] text-cyan-200/70">Wallet portfolio</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-50">Portfolio dashboard</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
              Live CLOB account state, wallet readiness, open risk, and recent trading activity in one view.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={isConnected && chainId === 137 ? "green" : "amber"}>
              <Wallet className="h-3 w-3" />
              {walletStatusText}
            </Badge>
            <Button disabled={!walletClient || loading} onClick={() => void refreshPortfolio()} size="sm" type="button" variant="secondary">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Retry / refresh
            </Button>
          </div>
        </div>

        <div className="mb-6 grid gap-3 lg:grid-cols-[1fr_1fr]">
          {error ? (
            <Card className="border-rose-400/30 bg-rose-950/30 shadow-xl shadow-black/15">
              <CardContent className="p-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex gap-3">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-200" />
                    <div>
                      <p className="font-semibold text-rose-100">Unable to load Polymarket account data</p>
                      <p className="mt-1 text-sm leading-6 text-rose-100/75">{error}</p>
                    </div>
                  </div>
                  <Button disabled={!walletClient || loading} onClick={() => void refreshPortfolio()} size="sm" type="button" variant="outline">
                    {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                    Retry
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {notice ? (
            <Card className="border-cyan-400/25 bg-cyan-950/20 lg:col-span-2">
              <CardContent className="flex gap-3 p-4 text-sm text-cyan-100">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{notice}</span>
              </CardContent>
            </Card>
          ) : null}

          <Card className="border-slate-800/90 bg-slate-950/72 shadow-xl shadow-black/15 lg:col-span-2">
            <CardHeader className="pb-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle>Trading readiness</CardTitle>
                  <CardDescription>Informational state only. Trade setup now runs from the Markets panel.</CardDescription>
                </div>
                <Badge tone={accountReady ? "green" : "amber"}>{accountReady ? "Ready" : "Setup needed"}</Badge>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {[
                { label: "Wallet connected", ok: walletReady, detail: walletStatusText },
                { label: "Deposit wallet", ok: depositWalletReady, detail: depositWalletReady ? "Trading wallet deployed" : "Will initialize on first trade" },
                { label: "Balance", ok: balanceReady, detail: balance.source === "polymarket" ? `$${balance.usdc.balance.toFixed(2)} available` : "Load live balance from account" },
                { label: "Allowances", ok: allowanceReady, detail: allowanceReady ? "USDC and CTF allowances ready" : "Will sync inside the trade flow" },
              ].map((item) => (
                <div className="rounded-lg border border-slate-800 bg-black/20 p-3" key={item.label}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs uppercase tracking-[0.16em] text-slate-500">{item.label}</p>
                    <Badge tone={item.ok ? "green" : "amber"}>{item.ok ? "Ready" : "Pending"}</Badge>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-300">{item.detail}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <DashboardMetric detail={accountStatusDetail} label="Account status" tone={accountReady ? "green" : "amber"} value={accountReady ? "Ready" : "Review"} />
          <DashboardMetric detail={balance.source === "mock" ? "Connect wallet for live CLOB balance" : "Live CLOB balance allowance"} label="USDC balance" value={formatCurrency(balance.usdc.balance)} />
          <DashboardMetric detail={`${positions.length} position${positions.length === 1 ? "" : "s"} tracked`} label="Open exposure" tone="cyan" value={formatCurrency(totalPositionValue)} />
          <DashboardMetric detail="Not real PnL. Requires production fill reconciliation." label="PnL placeholder" tone={pnl.total >= 0 ? "green" : "rose"} value={formatCurrency(pnl.total)} />
        </section>

        <section className="mt-6 grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
          <Card className="border-slate-800/90 bg-slate-950/72 shadow-xl shadow-black/15">
            <CardHeader className="pb-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle>Wallet summary</CardTitle>
                  <CardDescription>Connected wallet, derived trading wallet, and account readiness.</CardDescription>
                </div>
                <Badge tone={depositWallet?.initialized ? "green" : "slate"}>{depositWallet?.initialized ? "Trading wallet deployed" : "Derived wallet"}</Badge>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border border-slate-800 bg-black/20 p-3">
                <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Connected wallet</p>
                <p className="mt-2 break-all font-mono text-sm text-slate-100" title={address}>{formatAddress(address)}</p>
              </div>
              <div className="rounded-lg border border-slate-800 bg-black/20 p-3">
                <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Deposit wallet</p>
                <p className="mt-2 break-all font-mono text-sm text-slate-100" title={depositWallet?.depositWallet}>
                  {depositWallet?.depositWallet ? formatAddress(depositWallet.depositWallet) : "Not initialized or disconnected"}
                </p>
              </div>
              {isConnected && chainId === 137 && depositWallet && !depositWallet.initialized ? (
                <div className="md:col-span-2 rounded-lg border border-cyan-400/25 bg-cyan-400/10 p-4">
                  <div className="flex gap-3">
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-cyan-200" />
                    <div>
                      <p className="font-semibold text-cyan-50">Trading wallet will initialize on first trade</p>
                      <p className="mt-1 text-sm leading-6 text-cyan-100/75">
                        Markets will derive the deposit wallet, sync allowances, and submit the order inline.
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="border-slate-800/90 bg-slate-950/72 shadow-xl shadow-black/15">
            <CardHeader className="pb-4">
              <CardTitle>Balances and allowances</CardTitle>
              <CardDescription>Collateral, conditional token approvals, and pUSD state.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                { label: "Exchange allowance", value: balance.usdc.exchangeAllowance, ok: balance.usdc.hasExchangeAllowance },
                { label: "CTF allowance", value: balance.usdc.ctfAllowance, ok: balance.usdc.hasCtfAllowance },
                { label: "pUSD balance", value: balance.pUsd ? formatCurrency(balance.pUsd.balance) : "Unavailable", ok: Boolean(balance.pUsd) },
              ].map((item) => (
                <div className="rounded-lg border border-slate-800 bg-black/20 p-3" key={item.label}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs uppercase tracking-[0.16em] text-slate-500">{item.label}</p>
                    <Badge tone={item.ok ? "green" : "amber"}>{item.ok ? "OK" : "Missing"}</Badge>
                  </div>
                  <p className="mt-2 truncate font-mono text-xs text-slate-300" title={item.value ?? "0"}>{item.value ?? "0"}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>

        <section className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <Card className="border-slate-800/90 bg-slate-950/72 shadow-xl shadow-black/15">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle>Open positions</CardTitle>
                  <CardDescription>Grouped by detected sport for faster scanning.</CardDescription>
                </div>
                <Badge tone="cyan">
                  <Activity className="h-3 w-3" />
                  {positions.length}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {Object.entries(positionsBySport).map(([sport, sportPositions]) => (
                  <div key={sport}>
                    <h3 className="mb-2 text-xs uppercase tracking-[0.18em] text-slate-500">{sport}</h3>
                    <div className="space-y-2">
                      {sportPositions.map((position) => (
                        <div className="rounded-lg border border-slate-800 bg-black/20 p-3 text-sm" key={`${position.market}-${position.outcome}`}>
                          <div className="flex justify-between gap-3">
                            <span className="min-w-0 truncate font-medium text-slate-100">{position.market}</span>
                            <span className="shrink-0 font-semibold text-slate-50">{formatCurrency(position.value)}</span>
                          </div>
                          <p className="mt-1 text-slate-400">
                            {position.shares.toFixed(2)} {position.outcome} at {(position.avgPrice * 100).toFixed(1)}c avg
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                {positions.length === 0 ? <EmptyState detail="Connect a wallet or import activity to populate live and tracked positions." title="No open positions found" /> : null}
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-800/90 bg-slate-950/72 shadow-xl shadow-black/15">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle>Open orders</CardTitle>
                  <CardDescription>Live CLOB orders available for cancellation.</CardDescription>
                </div>
                <Badge tone={openOrders.length > 0 ? "amber" : "slate"}>{openOrders.length}</Badge>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <p className="flex items-center gap-2 rounded-lg border border-slate-800 bg-black/20 p-4 text-sm text-slate-400">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading CLOB account data
                </p>
              ) : openOrders.length > 0 ? (
                <div className="space-y-2">
                  {openOrders.slice(0, 10).map((order) => (
                    <div className="rounded-lg border border-slate-800 bg-black/20 p-3 text-sm" key={order.id}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-100">{order.outcome || order.asset_id}</p>
                          <p className="mt-1 text-slate-400">
                            {order.side} {Number(order.original_size || 0).toFixed(2)} at {(Number(order.price || 0) * 100).toFixed(1)}c
                          </p>
                          <p className="mt-1 break-all font-mono text-xs text-slate-500">{order.id}</p>
                        </div>
                        <Button disabled={cancellingOrderId === order.id} onClick={() => void handleCancel(order.id)} size="sm" type="button" variant="outline">
                          {cancellingOrderId === order.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState detail="Resting orders from the connected CLOB account will appear here." title="No open orders" />
              )}
            </CardContent>
          </Card>

          <Card className="border-slate-800/90 bg-slate-950/72 shadow-xl shadow-black/15 xl:col-span-2">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle>Trade history</CardTitle>
                  <CardDescription>Recent fills and wallet activity from the account endpoint.</CardDescription>
                </div>
                <Badge tone="slate">
                  <Clock className="h-3 w-3" />
                  {trades.length}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {trades.length > 0 ? (
                <div className="space-y-2">
                  {trades.slice(0, 12).map((trade, index) => {
                    const row = trade as Record<string, unknown>;
                    return (
                      <div className="grid gap-2 rounded-lg border border-slate-800 bg-black/20 p-3 text-sm md:grid-cols-[1fr_100px_100px_150px]" key={String(row.id ?? index)}>
                        <span className="truncate text-slate-100">{String(row.outcome ?? row.asset_id ?? row.market ?? "Trade")}</span>
                        <span className={String(row.side) === "BUY" ? "text-emerald-300" : "text-rose-300"}>{String(row.side ?? "-")}</span>
                        <span className="text-slate-300">{row.price ? `${(Number(row.price) * 100).toFixed(1)}c` : "-"}</span>
                        <span className="truncate text-slate-500">{String(row.match_time ?? row.created_at ?? "")}</span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <EmptyState detail="Completed CLOB trades for the connected wallet will appear after account data loads." title="No trade history loaded" />
              )}
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}
