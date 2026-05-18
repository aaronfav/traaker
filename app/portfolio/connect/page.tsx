"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import {
  connectWalletSource,
  disconnectWalletSource,
  getWalletSyncStatus,
  importTransactions,
  initConnectedWalletsFromStorage,
  initWalletSyncFromStorage,
  listConnectedWallets,
  recordWalletSyncStatus,
  subscribeConnectedWallets,
  subscribeWalletSyncStatus,
  type TransactionInput,
  type WalletSyncStatus,
} from "@/src/lib/storage";

type WalletTradesResponse = {
  connectedWalletAddress: string;
  proxyWallet: string;
  tradesFound: number;
  transactions: TransactionInput[];
  error?: string;
};

type WalletProfileResponse = {
  connectedWalletAddress: string;
  polymarketProxyWallet: string | null;
  profileName?: string | null;
  error?: string;
};

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};

const EMPTY_STATUS: WalletSyncStatus | null = null;

const getInjectedProvider = (): Eip1193Provider | null => {
  if (typeof window === "undefined") return null;
  return (window.ethereum as Eip1193Provider | undefined) ?? null;
};

const subscribeForWalletStatus = (listener: () => void) => subscribeWalletSyncStatus(listener);

export default function ConnectWalletPage() {
  const [hasInjectedWallet, setHasInjectedWallet] = useState(false);
  const [connectedWalletAddress, setConnectedWalletAddress] = useState<string | null>(null);
  const [polymarketProxyWallet, setPolymarketProxyWallet] = useState<string | null>(null);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [resolvingProfile, setResolvingProfile] = useState(false);
  const [importing, setImporting] = useState(false);
  const [disconnectingWalletId, setDisconnectingWalletId] = useState<string | null>(null);
  const [result, setResult] = useState<WalletSyncStatus | null>(null);

  useEffect(() => {
    initWalletSyncFromStorage();
    initConnectedWalletsFromStorage();
  }, []);

  const resolveProfile = async (address: string) => {
    setResolvingProfile(true);
    setError(null);

    try {
      const response = await fetch(`/api/wallet/profile?address=${encodeURIComponent(address)}`, {
        cache: "no-store",
      });
      const data = (await response.json()) as WalletProfileResponse;

      if (!response.ok) {
        setError(data.error ?? "Unable to resolve the Polymarket proxy wallet.");
        setPolymarketProxyWallet(null);
        setProfileName(null);
        return;
      }

      setPolymarketProxyWallet(data.polymarketProxyWallet);
      setProfileName(data.profileName ?? null);
    } catch {
      setError("Unable to resolve the Polymarket proxy wallet.");
      setPolymarketProxyWallet(null);
      setProfileName(null);
    } finally {
      setResolvingProfile(false);
    }
  };

  useEffect(() => {
    const provider = getInjectedProvider();
    setHasInjectedWallet(Boolean(provider));
    if (!provider) return;

    let cancelled = false;
    let lastConnectedAddress: string | null = null;

    const syncAccounts = async () => {
      try {
        const accounts = (await provider.request({ method: "eth_accounts" })) as string[];
        const address = accounts[0]?.toLowerCase() ?? null;
        if (cancelled) return;
        lastConnectedAddress = address;
        setConnectedWalletAddress(address);
        setResult(null);
        if (address) {
          void resolveProfile(address);
        } else {
          setPolymarketProxyWallet(null);
          setProfileName(null);
        }
      } catch {
        if (!cancelled) {
          setHasInjectedWallet(false);
        }
      }
    };

    const handleAccountsChanged = (...args: unknown[]) => {
      const accounts = Array.isArray(args[0]) ? (args[0] as string[]) : [];
      const address = accounts[0]?.toLowerCase() ?? null;
      const previousAddress = lastConnectedAddress;
      lastConnectedAddress = address;
      setConnectedWalletAddress(address);
      setResult(null);
      if (address) {
        void resolveProfile(address);
      } else {
        if (previousAddress) {
          disconnectWalletSource(previousAddress);
        }
        setPolymarketProxyWallet(null);
        setProfileName(null);
      }
    };

    void syncAccounts();
    provider.on?.("accountsChanged", handleAccountsChanged);

    return () => {
      cancelled = true;
      provider.removeListener?.("accountsChanged", handleAccountsChanged);
    };
  }, []);

  const storedStatus = useSyncExternalStore(
    subscribeForWalletStatus,
    () => (connectedWalletAddress ? getWalletSyncStatus(connectedWalletAddress) : EMPTY_STATUS),
    () => EMPTY_STATUS,
  );
  const connectedWallets = useSyncExternalStore(subscribeConnectedWallets, listConnectedWallets, () => []);

  const activeStatus = result ?? storedStatus;
  const canImport = Boolean(connectedWalletAddress && polymarketProxyWallet && !resolvingProfile);

  const handleConnectWallet = async () => {
    const provider = getInjectedProvider();
    if (!provider) {
      setError("No injected wallet was found. Open this page in MetaMask or another browser wallet.");
      return;
    }

    setConnecting(true);
    setError(null);

    try {
      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      const address = accounts[0]?.toLowerCase() ?? null;
      setConnectedWalletAddress(address);
      setResult(null);

      if (!address) {
        setPolymarketProxyWallet(null);
        setProfileName(null);
        setError("Wallet connected, but no account was returned.");
        return;
      }

      connectWalletSource(address);
      await resolveProfile(address);
    } catch {
      setError("Wallet connection was not completed.");
    } finally {
      setConnecting(false);
    }
  };

  const handleImportTrades = async () => {
    if (!connectedWalletAddress || !polymarketProxyWallet) return;

    setImporting(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/wallet/trades?connectedWalletAddress=${encodeURIComponent(connectedWalletAddress)}&proxyWallet=${encodeURIComponent(polymarketProxyWallet)}`,
        { cache: "no-store" },
      );
      const data = (await response.json()) as WalletTradesResponse;

      if (!response.ok) {
        setError(data.error ?? "Unable to fetch wallet trades.");
        return;
      }

      const importResult = importTransactions(data.transactions);
      connectWalletSource(connectedWalletAddress);
      const status = recordWalletSyncStatus({
        connectedWalletAddress,
        polymarketProxyWallet,
        tradesFound: data.tradesFound,
        tradesImported: importResult.imported,
        duplicatesSkipped: importResult.duplicatesSkipped,
        lastSyncedAt: new Date().toISOString(),
      });

      setResult(status);
    } catch {
      setError("Unable to fetch wallet trades.");
    } finally {
      setImporting(false);
    }
  };

  const handleDisconnectWallet = (walletAddress: string) => {
    setDisconnectingWalletId(walletAddress);
    setError(null);

    try {
      disconnectWalletSource(walletAddress);
      if (connectedWalletAddress === walletAddress) {
        setConnectedWalletAddress(null);
        setPolymarketProxyWallet(null);
        setProfileName(null);
        setResult(null);
      }
    } catch {
      setError("Unable to disconnect this wallet right now.");
    } finally {
      setDisconnectingWalletId(null);
    }
  };

  const proxyStateMessage = useMemo(() => {
    if (!connectedWalletAddress) return "Connect a wallet to resolve its Polymarket trading wallet.";
    if (resolvingProfile) return "Resolving Polymarket proxy wallet...";
    if (polymarketProxyWallet) return "Proxy wallet resolved. Trades will import from the Polymarket trading wallet.";
    return "No Polymarket proxy wallet found for this address yet.";
  }, [connectedWalletAddress, polymarketProxyWallet, resolvingProfile]);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <section className="rounded-[32px] border border-slate-800 bg-slate-950/80 p-6 shadow-2xl shadow-black/30 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <p className="text-[11px] uppercase tracking-[0.28em] text-cyan-300/80">Wallet Sync</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-50">Connect Wallet</h1>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Connect your EOA, resolve its Polymarket proxy wallet, and import those trades into the portfolio without affecting manual records.
            </p>
          </div>
          <Link
            href="/portfolio"
            className="rounded-2xl border border-white/10 px-4 py-2.5 text-sm text-slate-300 transition hover:bg-white/5"
          >
            Back to Portfolio
          </Link>
        </div>

        <section className="mt-8 rounded-[28px] border border-white/8 bg-white/[0.03] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-100">Wallet connection</h2>
              <p className="mt-1 text-sm text-slate-400">
                Uses an injected browser wallet provider to read the connected EOA before resolving the Polymarket proxy wallet.
              </p>
            </div>
            <button
              type="button"
              onClick={handleConnectWallet}
              disabled={connecting || !hasInjectedWallet}
              className="rounded-2xl bg-cyan-400 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {connecting ? "Connecting..." : connectedWalletAddress ? "Reconnect Wallet" : "Connect Wallet"}
            </button>
          </div>

          {!hasInjectedWallet ? (
            <p className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
              No injected wallet was detected. Open the app in MetaMask or another browser wallet to connect.
            </p>
          ) : null}

          {error ? (
            <p className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>
          ) : null}

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-white/8 bg-slate-950/40 p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Connected wallet</p>
              <p className="mt-2 break-all text-sm text-slate-100">{connectedWalletAddress ?? "Not connected"}</p>
              {profileName ? <p className="mt-2 text-xs text-slate-500">{profileName}</p> : null}
            </div>
            <div className="rounded-2xl border border-white/8 bg-slate-950/40 p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Polymarket trading wallet</p>
              <p className="mt-2 break-all text-sm text-slate-100">{polymarketProxyWallet ?? "No proxy wallet found"}</p>
              <p className="mt-2 text-xs text-slate-500">{proxyStateMessage}</p>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleImportTrades}
              disabled={!canImport || importing}
              className="rounded-2xl border border-white/10 px-4 py-3 text-sm font-semibold text-slate-100 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {importing ? "Importing..." : "Import Polymarket Trades"}
            </button>
            <p className="text-sm text-slate-500">
              Manual records stay persisted independently. Disconnecting a wallet removes only that wallet&apos;s imported trades.
            </p>
          </div>
        </section>

        <section className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="rounded-[28px] border border-white/8 bg-white/[0.03] p-5">
            <h2 className="text-lg font-semibold text-slate-100">Sync result</h2>
            {activeStatus ? (
              <div className="mt-4 space-y-3">
                <div className="rounded-2xl border border-white/8 bg-slate-950/40 p-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Connected wallet</p>
                  <p className="mt-2 break-all text-sm text-slate-100">{activeStatus.connectedWalletAddress}</p>
                </div>
                <div className="rounded-2xl border border-white/8 bg-slate-950/40 p-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Polymarket proxy wallet</p>
                  <p className="mt-2 break-all text-sm text-slate-100">{activeStatus.polymarketProxyWallet ?? "No proxy wallet recorded"}</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-white/8 bg-slate-950/40 p-4">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Trades found</p>
                    <p className="mt-2 text-2xl font-semibold text-slate-100">{activeStatus.tradesFound}</p>
                  </div>
                  <div className="rounded-2xl border border-white/8 bg-slate-950/40 p-4">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Trades imported</p>
                    <p className="mt-2 text-2xl font-semibold text-slate-100">{activeStatus.tradesImported}</p>
                  </div>
                  <div className="rounded-2xl border border-white/8 bg-slate-950/40 p-4">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Duplicates skipped</p>
                    <p className="mt-2 text-2xl font-semibold text-slate-100">{activeStatus.duplicatesSkipped}</p>
                  </div>
                  <div className="rounded-2xl border border-white/8 bg-slate-950/40 p-4">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Last synced</p>
                    <p className="mt-2 text-sm font-medium text-slate-100">{new Date(activeStatus.lastSyncedAt).toLocaleString()}</p>
                  </div>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-400">No sync recorded for this connected wallet yet.</p>
            )}
          </div>

          <div className="rounded-[28px] border border-white/8 bg-white/[0.03] p-5">
            <h2 className="text-lg font-semibold text-slate-100">Import behavior</h2>
            <div className="mt-4 space-y-3 text-sm leading-6 text-slate-400">
              <p>Wallet trades are stored with a wallet-specific source id, while manual records stay as independent first-class saved transactions.</p>
              <p>Deduplication prefers `externalTradeId`; if it is missing, a stable composite key prevents duplicate syncs.</p>
              <p>Disconnecting a wallet removes only the imports tied to that connected wallet address. Manual transactions and other wallet sources remain intact.</p>
            </div>
          </div>
        </section>

        <section className="mt-6 rounded-[28px] border border-white/8 bg-white/[0.03] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-100">Connected wallet sources</h2>
              <p className="mt-1 text-sm text-slate-400">Disconnect a wallet here to remove only its imported portfolio data.</p>
            </div>
          </div>

          {connectedWallets.length > 0 ? (
            <div className="mt-4 space-y-3">
              {connectedWallets.map((walletAddress) => {
                const walletStatus = getWalletSyncStatus(walletAddress);

                return (
                  <div key={walletAddress} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/8 bg-slate-950/40 p-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Connected wallet source</p>
                      <p className="mt-2 break-all text-sm text-slate-100">{walletAddress}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {walletStatus ? `Last synced ${new Date(walletStatus.lastSyncedAt).toLocaleString()}` : "No wallet sync recorded yet."}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDisconnectWallet(walletAddress)}
                      disabled={disconnectingWalletId === walletAddress}
                      className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200 transition hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {disconnectingWalletId === walletAddress ? "Disconnecting..." : "Disconnect wallet"}
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-400">No connected wallet sources are currently persisted.</p>
          )}
        </section>
      </section>
    </main>
  );
}
