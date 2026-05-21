import type { PortfolioBalanceState } from "./types";

export type TradeSetupStepKey =
  | "wallet_connected"
  | "deposit_wallet_initialized"
  | "usdc_balance"
  | "exchange_allowance"
  | "ctf_allowance"
  | "ready_to_trade";

export type TradeSetupStep = {
  key: TradeSetupStepKey;
  label: string;
  detail: string;
  ready: boolean;
  actionLabel?: string;
  actionHref?: string;
};

export type TradeReadinessInput = {
  configReady: boolean;
  configError?: string | null;
  realTradingEnabled: boolean;
  isConnected: boolean;
  chainId?: number | null;
  depositWalletInitialized: boolean | null;
  balance: PortfolioBalanceState | null;
  accountError?: string | null;
  quoteFresh: boolean;
};

const isPositiveBalance = (value: number) => Number.isFinite(value) && value > 0;

export function isBytes32Hex(value: unknown) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value.trim());
}

export function buildPortfolioSetupSteps(input: {
  isConnected: boolean;
  chainId?: number | null;
  configReady: boolean;
  configError?: string | null;
  depositWalletInitialized: boolean | null;
  balance: PortfolioBalanceState | null;
}): TradeSetupStep[] {
  const walletReady = input.isConnected && input.chainId === 137;
  const balance = input.balance;
  const balanceReady = Boolean(balance && balance.source === "polymarket");
  const positiveBalance = isPositiveBalance(balance?.usdc.balance ?? 0);
  const exchangeAllowanceReady = Boolean(balanceReady && balance?.usdc.hasExchangeAllowance);
  const ctfAllowanceReady = Boolean(balanceReady && balance?.usdc.hasCtfAllowance);
  const readyToTrade = walletReady && input.configReady && input.depositWalletInitialized === true && balanceReady && positiveBalance && exchangeAllowanceReady && ctfAllowanceReady;

  return [
    {
      key: "wallet_connected",
      label: "Wallet connected",
      detail: walletReady ? "Polygon wallet connected." : "Connect a wallet on Polygon to continue.",
      ready: walletReady,
      actionLabel: walletReady ? undefined : "Open connect flow",
      actionHref: walletReady ? undefined : "/portfolio/connect",
    },
    {
      key: "deposit_wallet_initialized",
      label: "Deposit wallet initialized",
      detail:
        input.depositWalletInitialized === true
          ? "Trading wallet is deployed."
          : input.depositWalletInitialized === false
            ? "Trading wallet is not initialized yet. Open the connect flow to initialize or resolve it."
            : "Resolve the wallet state to continue.",
      ready: input.depositWalletInitialized === true,
      actionLabel: input.depositWalletInitialized === true ? undefined : "Open connect flow",
      actionHref: input.depositWalletInitialized === true ? undefined : "/portfolio/connect",
    },
    {
      key: "usdc_balance",
      label: "USDC balance detected",
      detail:
        balanceReady && positiveBalance
          ? `$${balance!.usdc.balance.toFixed(2)} available.`
          : "No live USDC balance detected yet.",
      ready: Boolean(balanceReady && positiveBalance),
      actionLabel: balance?.source === "polymarket" ? "Refresh balances" : "Load balances",
    },
    {
      key: "exchange_allowance",
      label: "Exchange allowance approved",
      detail:
        balance?.source === "polymarket" && balance.usdc.hasExchangeAllowance
          ? "Exchange allowance is in place."
          : "Exchange allowance is missing or zero.",
      ready: exchangeAllowanceReady,
      actionLabel: "Refresh allowances",
    },
    {
      key: "ctf_allowance",
      label: "CTF allowance approved",
      detail:
        balance?.source === "polymarket" && balance.usdc.hasCtfAllowance
          ? "CTF allowance is in place."
          : "CTF allowance is missing or zero.",
      ready: ctfAllowanceReady,
      actionLabel: "Refresh allowances",
    },
    {
      key: "ready_to_trade",
      label: "Ready to trade",
      detail:
        readyToTrade
          ? "All setup checks passed."
          : "Complete the setup steps above.",
      ready: readyToTrade,
    },
  ];
}

export function getTradeDisabledReason(input: TradeReadinessInput) {
  if (input.configError) return input.configError;
  if (!input.configReady && input.realTradingEnabled) return "Trading configuration unavailable. Try again after deployment configuration is updated.";
  if (!input.isConnected) return "Connect a wallet before trading.";
  if (input.chainId !== 137) return "Switch to Polygon mainnet before trading.";
  if (input.realTradingEnabled && input.quoteFresh === false) return "Refresh quote.";
  return null;
}
