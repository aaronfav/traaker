"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, ShieldCheck, FlaskConical } from "lucide-react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getDepositWalletStatus } from "@/lib/polymarket/depositWallet";
import { createSignerClient, SignatureTypeV2 } from "@/lib/polymarket/client";
import { OrderType, placeLimitOrder, placeMarketOrder, Side, validateTrade } from "@/lib/polymarket/orders";
import { getPositions } from "@/lib/polymarket/portfolio";
import type { TerminalMarket } from "@/lib/polymarket/types";

type TradeMode = "limit" | "market";
type Outcome = "yes" | "no";

export function TradeTicket({
  market,
  initialOutcome = "yes",
  realTradingEnabled = false,
}: {
  market: TerminalMarket;
  initialOutcome?: Outcome;
  realTradingEnabled?: boolean;
}) {
  const { chainId, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient({ chainId: 137 });
  const publicClient = usePublicClient({ chainId: 137 });
  const [outcome, setOutcome] = useState<Outcome>(initialOutcome);
  const [mode, setMode] = useState<TradeMode>("limit");
  const [amount, setAmount] = useState("25");
  const [limitPrice, setLimitPrice] = useState(String(Math.round(market.yesPrice * 100)));
  const [slippage, setSlippage] = useState("100");
  const [reviewing, setReviewing] = useState(false);
  const [status, setStatus] = useState<"idle" | "validating" | "submitting" | "pending" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [orderId, setOrderId] = useState("");
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [availableBalance, setAvailableBalance] = useState<number | null>(null);
  const [builderCode, setBuilderCode] = useState("");
  const [depositWalletAddress, setDepositWalletAddress] = useState<string | null>(null);
  const [depositWalletInitialized, setDepositWalletInitialized] = useState<boolean | null>(null);

  const price = outcome === "yes" ? market.yesPrice : market.noPrice;
  const tradePrice = mode === "limit" ? Number(limitPrice) / 100 : price;
  const usdcAmount = Number(amount);
  const estimatedShares = Number.isFinite(usdcAmount) && tradePrice > 0 ? usdcAmount / tradePrice : 0;
  const estimatedFees = usdcAmount * 0.002;
  const tokenID = outcome === "yes" ? market.tokenIds.yes : market.tokenIds.no;

  const parsedSlippage = Number(slippage);

  useEffect(() => {
    let active = true;

    fetch("/api/polymarket/config", { cache: "no-store" })
      .then((response) => response.json())
      .then((data: { builderCode?: string }) => {
        if (active && data.builderCode) setBuilderCode(data.builderCode);
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    void (async () => {
      if (!walletClient || !isConnected || chainId !== 137 || !publicClient) {
        if (!active) return;
        setDepositWalletAddress(null);
        setDepositWalletInitialized(null);
        return;
      }

      try {
        const status = await getDepositWalletStatus(walletClient.account.address, publicClient);
        if (!active) return;
        setDepositWalletAddress(status.depositWallet);
        setDepositWalletInitialized(status.initialized);
      } catch {
        if (!active) return;
        setDepositWalletAddress(null);
        setDepositWalletInitialized(null);
      }
    })();

    return () => {
      active = false;
    };
  }, [chainId, isConnected, publicClient, walletClient]);

  const validation = useMemo(
    () =>
      validateTrade({
        walletConnected: isConnected,
        chainId: chainId ?? 0,
        tokenID,
        amount: Number.isFinite(usdcAmount) ? usdcAmount : 0,
        price: Number.isFinite(tradePrice) ? tradePrice : 0,
        slippageBps: Number.isFinite(parsedSlippage) ? parsedSlippage : -1,
        availableBalance: availableBalance ?? Number.MAX_SAFE_INTEGER,
        builderCode,
      }),
    [availableBalance, builderCode, chainId, isConnected, parsedSlippage, tokenID, tradePrice, usdcAmount],
  );

  const canSubmit = realTradingEnabled
    ? Boolean(walletClient && validation.ok && depositWalletInitialized === true)
    : validation.ok;

  function extractOrderId(response: unknown) {
    if (!response || typeof response !== "object") return "";
    const record = response as Record<string, unknown>;
    return String(record.orderID ?? record.orderId ?? record.order_id ?? record.hash ?? record.id ?? "");
  }

  async function submit() {
    setStatus("validating");
    setMessage("Checking balance, token, price, slippage, and wallet state.");
    setValidationErrors([]);

    try {
      if (!realTradingEnabled) {
        if (!validation.ok) {
          setValidationErrors(validation.errors);
          setStatus("error");
          setMessage(validation.errors[0] ?? "Dry-run validation failed.");
          return;
        }
        setStatus("success");
        setMessage("Dry-run validation passed. Real order submission is disabled by ENABLE_REAL_TRADING.");
        setReviewing(false);
        return;
      }

      if (!walletClient) return;
      const client = await createSignerClient({
        signer: walletClient,
        signatureType: SignatureTypeV2.POLY_1271,
        funderAddress: depositWalletInitialized === true ? depositWalletAddress ?? undefined : undefined,
        builderCode,
      });
      const accountResponse = await fetch("/api/polymarket/account", { cache: "no-store" });
      const accountData = await accountResponse.json();
      const liveUsdcBalance = Number(accountData.balance?.balance ?? 0) / 1_000_000;
      setAvailableBalance(liveUsdcBalance);

      const liveValidation = validateTrade({
        walletConnected: isConnected,
        chainId: chainId ?? 0,
        tokenID,
        amount: usdcAmount,
        price: tradePrice,
        slippageBps: parsedSlippage,
        availableBalance: liveUsdcBalance,
        builderCode,
      });

      if (!liveValidation.ok) {
        setValidationErrors(liveValidation.errors);
        setStatus("error");
        setMessage(liveValidation.errors[0] ?? "Trade validation failed.");
        return;
      }

      setStatus("submitting");
      setMessage("Posting signed order to Polymarket CLOB V2.");

      const response =
        mode === "limit"
          ? await placeLimitOrder(client, {
              tokenID,
              price: tradePrice,
              size: estimatedShares,
              side: Side.BUY,
              builderCode,
            })
          : await placeMarketOrder(client, {
              tokenID,
              amount: usdcAmount,
              currentPrice: price,
              maxSlippageBps: Number(slippage),
              orderType: OrderType.FOK,
              side: Side.BUY,
              builderCode,
            });

      const nextOrderId = extractOrderId(response);
      setOrderId(nextOrderId);
      setStatus("pending");
      setMessage(nextOrderId ? `Order accepted. Waiting for open-order refresh: ${nextOrderId}` : "Order accepted. Refreshing open orders.");
      await Promise.allSettled([fetch("/api/polymarket/account", { cache: "no-store" }), getPositions()]);
      setStatus("success");
      setMessage(nextOrderId ? `Order live or filled: ${nextOrderId}` : `Order submitted: ${JSON.stringify(response).slice(0, 180)}`);
      setReviewing(false);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? `Polymarket rejected the order: ${error.message}` : "Polymarket rejected the order. Check wallet setup, balance, allowances, and market liquidity.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Trade ticket</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {!realTradingEnabled ? (
          <div className="flex gap-2 rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-200">
            <AlertCircle className="mt-0.5 h-4 w-4" />
            Trading disabled. This deployment only runs dry-run validation until ENABLE_REAL_TRADING=true.
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-2">
          {(["yes", "no"] as const).map((option) => (
            <Button key={option} onClick={() => setOutcome(option)} type="button" variant={outcome === option ? "default" : "secondary"}>
              Buy {option.toUpperCase()}
            </Button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2">
          {(["limit", "market"] as const).map((option) => (
            <Button key={option} onClick={() => setMode(option)} type="button" variant={mode === option ? "outline" : "ghost"}>
              {option === "limit" ? "Limit" : "Marketable"}
            </Button>
          ))}
        </div>

        <label className="block space-y-2 text-sm">
          <span className="text-slate-300">Amount USDC</span>
          <Input min="1" onChange={(event) => setAmount(event.target.value)} type="number" value={amount} />
        </label>

        {mode === "limit" ? (
          <label className="block space-y-2 text-sm">
            <span className="text-slate-300">Limit price, cents</span>
            <Input max="99" min="1" onChange={(event) => setLimitPrice(event.target.value)} type="number" value={limitPrice} />
          </label>
        ) : (
          <label className="block space-y-2 text-sm">
            <span className="text-slate-300">Slippage protection, bps</span>
            <Input max="1000" min="10" onChange={(event) => setSlippage(event.target.value)} type="number" value={slippage} />
          </label>
        )}

        <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4 text-sm">
          <div className="flex justify-between py-1">
            <span className="text-slate-400">Current price</span>
            <span>{(price * 100).toFixed(1)}c</span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-slate-400">Estimated shares</span>
            <span>{Number.isFinite(estimatedShares) ? estimatedShares.toFixed(2) : "0.00"}</span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-slate-400">Estimated fees</span>
            <span>${estimatedFees.toFixed(2)}</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge tone={chainId === 137 ? "green" : "amber"}>Polygon mainnet</Badge>
          <Badge tone="cyan">
            <ShieldCheck className="h-3 w-3" />
            Non-custodial
          </Badge>
          <Badge tone="slate">POLY_1271</Badge>
        </div>

        <label className="flex cursor-not-allowed items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/40 p-3 text-sm opacity-70">
          <span className="inline-flex items-center gap-2 text-slate-300">
            <FlaskConical className="h-4 w-4" />
            Simulation mode
          </span>
          <input checked={false} disabled readOnly type="checkbox" />
        </label>
        <p className="-mt-3 text-xs text-slate-500">
          {realTradingEnabled ? "Real orders require wallet review and live CLOB validation." : "Real order submission is disabled for production safety."}
        </p>

        {!tokenID ? (
          <div className="flex gap-2 rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-200">
            <AlertCircle className="mt-0.5 h-4 w-4" />
            This market is missing a CLOB token id, so live order submission is disabled.
          </div>
        ) : null}

        {validationErrors.length > 0 || (!validation.ok && availableBalance !== null) ? (
          <div className="rounded-lg border border-rose-400/30 bg-rose-400/10 p-3 text-sm text-rose-200">
            <div className="flex gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4" />
              <div className="space-y-1">
                {[...validationErrors, ...validation.errors].filter((item, index, all) => all.indexOf(item) === index).map((item) => (
                  <p key={item}>{item}</p>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {status !== "idle" ? (
          <div className={`flex gap-2 rounded-lg border p-3 text-sm ${status === "success" ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : status === "error" ? "border-rose-400/30 bg-rose-400/10 text-rose-200" : "border-cyan-400/30 bg-cyan-400/10 text-cyan-200"}`}>
            {status === "submitting" || status === "validating" || status === "pending" ? <Loader2 className="mt-0.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mt-0.5 h-4 w-4" />}
            <span className="break-all">{message}</span>
          </div>
        ) : null}

        {orderId ? (
          <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3 text-xs text-slate-400">
            <span className="text-slate-500">Order hash/id</span>
            <p className="mt-1 break-all font-mono text-slate-200">{orderId}</p>
          </div>
        ) : null}

        <Button className="w-full" disabled={!canSubmit || status === "submitting" || status === "validating" || status === "pending"} onClick={() => setReviewing(true)} type="button">
          Review trade
        </Button>

        {reviewing ? (
          <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/80 p-4 backdrop-blur">
            <div className="w-full max-w-md rounded-lg border border-slate-700 bg-slate-950 p-5 shadow-2xl">
              <h2 className="text-lg font-semibold text-slate-50">Review trade</h2>
              <p className="mt-2 text-sm text-slate-400">
                {realTradingEnabled ? "Buy" : "Dry-run"} {outcome.toUpperCase()} on {market.title} for ${usdcAmount.toFixed(2)} using a {mode} order.
              </p>
              <div className="mt-5 flex gap-2">
                <Button disabled={status === "submitting"} onClick={submit} type="button">
                  {status === "submitting" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {realTradingEnabled ? "Submit order" : "Validate dry run"}
                </Button>
                <Button onClick={() => setReviewing(false)} type="button" variant="secondary">
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {status === "error" ? (
          <div className="fixed bottom-4 right-4 z-50 max-w-sm rounded-lg border border-rose-400/30 bg-rose-950 p-4 text-sm text-rose-100 shadow-2xl">
            {message}
          </div>
        ) : null}

        <p className="text-xs leading-5 text-slate-500">
          Orders are signed by your wallet and posted to Polymarket CLOB V2. This interface never takes custody of funds.
        </p>
      </CardContent>
    </Card>
  );
}
