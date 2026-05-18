"use client";

import { useEffect, useState } from "react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { Wallet, Loader2, AlertTriangle, X, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
        const accountResponse = await fetch("/api/polymarket/account", { cache: "no-store" });
        const accountData = await accountResponse.json();
        if (!accountResponse.ok || !accountData.ok) throw new Error(accountData.error ?? "Unable to load Polymarket account data.");

        if (!active) return;
        setDepositWallet(walletStatus);
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
  const approvalWarnings = [
    !depositWallet?.initialized && isConnected && chainId === 137 ? "Polymarket deposit wallet is not initialized. Trading wallet setup is required before real orders can settle." : "",
    balance.source === "polymarket" && !balance.usdc.hasExchangeAllowance ? "Exchange allowance is missing or zero." : "",
    balance.source === "polymarket" && !balance.usdc.hasCtfAllowance ? "CTF allowance is missing or zero." : "",
  ].filter(Boolean);

  async function refreshPortfolio() {
    if (!isConnected || chainId !== 137) return;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const walletStatus = await getDepositWalletStatus(address as Address, publicClient);
      const accountResponse = await fetch("/api/polymarket/account", { cache: "no-store" });
      const accountData = await accountResponse.json();
      if (!accountResponse.ok || !accountData.ok) throw new Error(accountData.error ?? "Unable to load Polymarket account data.");
      setDepositWallet(walletStatus);
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
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.24em] text-cyan-200/80">Wallet portfolio</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-50">Balances, positions, and history</h1>
        </div>
        <Badge tone={isConnected && chainId === 137 ? "green" : "amber"}>
          <Wallet className="h-3 w-3" />
          {isConnected ? (chainId === 137 ? "Polygon connected" : "Wrong network") : "Wallet disconnected"}
        </Badge>
      </div>

      {error ? <div className="mb-4 rounded-lg border border-rose-400/30 bg-rose-400/10 p-3 text-sm text-rose-200">{error}</div> : null}
      {notice ? <div className="mb-4 rounded-lg border border-emerald-400/30 bg-emerald-400/10 p-3 text-sm text-emerald-200">{notice}</div> : null}
      {approvalWarnings.length > 0 ? (
        <div className="mb-4 rounded-lg border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
          <div className="flex gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4" />
            <div className="space-y-1">
              {approvalWarnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {isConnected && chainId === 137 && depositWallet && !depositWallet.initialized ? (
        <Card className="mb-6 border-cyan-400/30 bg-cyan-400/10">
          <CardContent className="p-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="flex gap-3">
                <Info className="mt-1 h-5 w-5 text-cyan-200" />
                <div>
                  <h2 className="font-semibold text-cyan-50">Set up your Polymarket trading wallet</h2>
                  <p className="mt-1 max-w-3xl text-sm leading-6 text-cyan-100/80">
                    Polymarket deposit wallets are non-custodial smart wallets used as the CLOB funder address. They let your connected wallet sign while the trading wallet holds balances and allowances.
                  </p>
                  <p className="mt-2 break-all font-mono text-xs text-cyan-100/70">{depositWallet.depositWallet}</p>
                </div>
              </div>
              <Button disabled type="button" variant="secondary">
                Setup handled on Polymarket
              </Button>
            </div>
            <p className="mt-3 text-xs text-cyan-100/70">Relayer deployment is intentionally not wired in Traak. Use the official Polymarket setup flow, then refresh balances here.</p>
          </CardContent>
        </Card>
      ) : null}

      <section className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Connected wallet</p>
            <p className="mt-3 break-all text-sm font-medium text-slate-100">{address ?? "Not connected"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Deposit wallet</p>
            <p className="mt-3 break-all text-sm font-medium text-slate-100">{depositWallet?.depositWallet ?? "Not initialized or wallet disconnected"}</p>
            <p className="mt-1 text-xs text-slate-500">{depositWallet?.initialized ? "Trading wallet deployed" : "Expected address derived with CREATE2"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">USDC / pUSD</p>
            <p className="mt-3 text-2xl font-semibold text-slate-50">${balance.usdc.balance.toFixed(2)}</p>
            <p className="mt-1 text-xs text-slate-500">{balance.source === "mock" ? "Connect wallet for live balance" : "Live CLOB balance allowance"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">PnL placeholder</p>
            <p className={pnl.total >= 0 ? "mt-3 text-2xl font-semibold text-emerald-300" : "mt-3 text-2xl font-semibold text-rose-300"}>
              ${pnl.total.toFixed(2)}
            </p>
            <p className="mt-1 text-xs text-slate-500">Not real PnL. Requires production fill reconciliation.</p>
          </CardContent>
        </Card>
      </section>

      <section className="mt-6 grid gap-4 md:grid-cols-3">
        {[
          { label: "Exchange allowance", value: balance.usdc.exchangeAllowance, ok: balance.usdc.hasExchangeAllowance },
          { label: "CTF allowance", value: balance.usdc.ctfAllowance, ok: balance.usdc.hasCtfAllowance },
          { label: "pUSD balance", value: balance.pUsd ? `$${balance.pUsd.balance.toFixed(2)}` : "Unavailable", ok: Boolean(balance.pUsd) },
        ].map((item) => (
          <Card key={item.label}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{item.label}</p>
                <Badge tone={item.ok ? "green" : "amber"}>{item.ok ? "OK" : "Missing"}</Badge>
              </div>
              <p className="mt-3 truncate font-mono text-xs text-slate-300" title={item.value ?? "0"}>
                {item.value ?? "0"}
              </p>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Open positions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {Object.entries(positionsBySport).map(([sport, sportPositions]) => (
                <div key={sport}>
                  <h3 className="mb-2 text-xs uppercase tracking-[0.18em] text-slate-500">{sport}</h3>
                  <div className="space-y-2">
                    {sportPositions.map((position) => (
                      <div className="rounded-md border border-slate-800 p-3 text-sm" key={`${position.market}-${position.outcome}`}>
                        <div className="flex justify-between gap-3">
                          <span className="font-medium text-slate-100">{position.market}</span>
                          <span>${position.value.toFixed(2)}</span>
                        </div>
                        <p className="mt-1 text-slate-400">
                          {position.shares.toFixed(2)} {position.outcome} at {(position.avgPrice * 100).toFixed(1)}c avg
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {positions.length === 0 ? <p className="text-sm text-slate-400">No open positions found.</p> : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Open orders</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="flex items-center gap-2 text-sm text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading CLOB account data
              </p>
            ) : openOrders.length > 0 ? (
              <div className="space-y-2">
                {openOrders.slice(0, 10).map((order) => (
                  <div className="rounded-md border border-slate-800 p-3 text-sm" key={order.id}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-100">{order.outcome || order.asset_id}</p>
                        <p className="mt-1 text-slate-400">
                          {order.side} {Number(order.original_size || 0).toFixed(2)} at {(Number(order.price || 0) * 100).toFixed(1)}c
                        </p>
                        <p className="mt-1 break-all font-mono text-xs text-slate-500">{order.id}</p>
                      </div>
                      <Button
                        disabled={cancellingOrderId === order.id}
                        onClick={() => void handleCancel(order.id)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        {cancellingOrderId === order.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                        Cancel
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400">No open orders.</p>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Trade history</CardTitle>
          </CardHeader>
          <CardContent>
            {trades.length > 0 ? (
              <div className="space-y-2">
                {trades.slice(0, 12).map((trade, index) => {
                  const row = trade as Record<string, unknown>;
                  return (
                    <div className="grid gap-2 rounded-md border border-slate-800 p-3 text-sm md:grid-cols-[1fr_100px_100px_140px]" key={String(row.id ?? index)}>
                      <span className="truncate text-slate-100">{String(row.outcome ?? row.asset_id ?? row.market ?? "Trade")}</span>
                      <span className={String(row.side) === "BUY" ? "text-emerald-300" : "text-rose-300"}>{String(row.side ?? "-")}</span>
                      <span className="text-slate-300">{row.price ? `${(Number(row.price) * 100).toFixed(1)}c` : "-"}</span>
                      <span className="text-slate-500">{String(row.match_time ?? row.created_at ?? "")}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-slate-400">No CLOB trades loaded for this wallet.</p>
            )}
          </CardContent>
        </Card>
      </section>

      <div className="mt-6">
        <Button disabled={!walletClient || loading} onClick={() => void refreshPortfolio()} variant="secondary">
          Refresh portfolio
        </Button>
      </div>

      {error ? (
        <div className="fixed bottom-4 right-4 z-50 max-w-sm rounded-lg border border-rose-400/30 bg-rose-950 p-4 text-sm text-rose-100 shadow-2xl">
          {error}
        </div>
      ) : null}
    </main>
  );
}
