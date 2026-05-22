import type { Address, PublicClient, WalletClient } from "viem";
import { getDepositWalletStatus } from "./depositWallet";
import { ensureTradingSession } from "./tradeService";
import {
  createRelayClient,
  ensureDepositWalletApprovals,
  ensureDepositWalletConditionalApproval,
  ensureDepositWalletDeployed,
  getPolymarketExchangeConfig,
} from "./relayer";
import type { PortfolioBalanceState } from "./types";

export type TradeProgress =
  | "idle"
  | "checking-wallet"
  | "initializing-trading-wallet"
  | "checking-balance"
  | "approving-trading"
  | "refreshing-quote"
  | "submitting-order";

export type TradeSetupResult = {
  depositWalletAddress: string;
  depositWalletInitialized: boolean;
  balance: PortfolioBalanceState;
  accountResponse: unknown;
};

type PolymarketAccountLoadOptions = {
  walletClient?: WalletClient;
  address?: Address;
  tradingWalletAddress?: string;
  signatureType?: 2 | 3;
  retryOnAuthInvalid?: boolean;
};

const safeJson = async <T,>(response: Response): Promise<T | null> => {
  const text = await response.text().catch(() => "");
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
};

const normalizeBalance = (raw: { balance?: string; allowances?: Record<string, string> } | null | undefined): PortfolioBalanceState => {
  const allowances = raw?.allowances ?? {};
  const values = Object.values(allowances);
  const exchangeAllowance = (values.find((value) => Boolean(value)) as string | undefined) ?? null;
  const ctfAllowance = values.length > 1 ? ((values[1] as string | undefined) ?? null) : null;
  return {
    usdc: {
      balance: Number(raw?.balance ?? 0) / 1_000_000,
      rawBalance: String(raw?.balance ?? "0"),
      allowances,
      exchangeAllowance,
      ctfAllowance,
      hasExchangeAllowance: Boolean(exchangeAllowance && BigInt(exchangeAllowance) > BigInt(0)),
      hasCtfAllowance: Boolean(ctfAllowance && BigInt(ctfAllowance) > BigInt(0)),
    },
    pUsd: null,
    conditional: null,
    source: "polymarket",
  };
};

export async function loadPolymarketAccount(options?: PolymarketAccountLoadOptions) {
  const response = await fetch("/api/polymarket/account", { cache: "no-store" });
  const data = await safeJson<{
    ok?: boolean;
    balance?: { balance?: string; allowances?: Record<string, string> };
    error?: string;
    code?: string;
  }>(response);
  if (!response.ok || !data?.ok) {
    if (
      options?.retryOnAuthInvalid !== false &&
      data?.code === "AUTH_INVALID_SESSION" &&
      options?.walletClient &&
      options?.address &&
      options?.tradingWalletAddress &&
      options?.signatureType
    ) {
      await ensureTradingSession(options.walletClient, 137, {
        force: true,
        tradingWalletAddress: options.tradingWalletAddress,
        signatureType: options.signatureType,
      });
      const retryResponse = await fetch("/api/polymarket/account", { cache: "no-store" });
      const retryData = await safeJson<{ ok?: boolean; balance?: { balance?: string; allowances?: Record<string, string> }; error?: string; code?: string }>(retryResponse);
      if (retryResponse.ok && retryData?.ok) {
        return {
          response: retryResponse,
          balance: normalizeBalance(retryData.balance ?? null),
        };
      }
      throw new Error(retryData?.error ?? "Polymarket session expired. Reinitializing trading session.");
    }
    throw new Error(data?.error ?? "Unable to load Polymarket account data.");
  }
  return {
    response,
    balance: normalizeBalance(data.balance ?? null),
  };
}

export async function loadTradingConfig() {
  const response = await fetch("/api/polymarket/config", { cache: "no-store" });
  const data = await safeJson<{ ok?: boolean; realTradingEnabled?: boolean; builderReady?: boolean; gaslessReady?: boolean; clobReady?: boolean; missingSetupReason?: string | null; error?: string }>(response);
  if (!response.ok || !data?.ok) {
    throw new Error(data?.error ?? "Trading configuration is unavailable.");
  }
  return {
    realTradingEnabled: Boolean(data.realTradingEnabled),
    builderReady: Boolean(data.builderReady),
    gaslessReady: Boolean(data.gaslessReady),
    clobReady: Boolean(data.clobReady),
    missingSetupReason: data.missingSetupReason ?? null,
  };
}

export async function syncBalanceAllowance(input: {
  signatureType: 3;
  tradingWalletAddress: string;
  assetType?: "COLLATERAL" | "CONDITIONAL";
  tokenId?: string;
  walletClient?: WalletClient;
  address?: Address;
  chainId?: number;
}) {
  if (input.walletClient && input.address) {
    await ensureTradingSession(input.walletClient, input.chainId ?? 137, {
      tradingWalletAddress: input.tradingWalletAddress,
      signatureType: input.signatureType,
    });
  }
  const response = await fetch("/api/polymarket/balance-allowance/update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      assetType: input.assetType ?? "COLLATERAL",
      signatureType: input.signatureType,
      signature_type: input.signatureType,
      tradingWalletAddress: input.tradingWalletAddress,
      funderAddress: input.tradingWalletAddress,
      tokenId: input.tokenId,
      token_id: input.tokenId,
    }),
  });
  const data = await safeJson<{ ok?: boolean; error?: string }>(response);
  if (!response.ok || !data?.ok) {
    throw new Error(data?.error ?? "Balance allowance update failed.");
  }
  return data;
}

export async function ensureTradingReady(input: {
  walletClient: unknown;
  address: Address;
  publicClient: unknown;
  side: "Buy" | "Sell";
  tokenId: string;
  amount: number;
  price: number;
  negRisk?: boolean;
  onProgress?: (stage: TradeProgress) => void;
}) {
  if (!input.walletClient || !input.address) {
    throw new Error("Connect a wallet before trading.");
  }
  input.onProgress?.("checking-wallet");
  const config = await loadTradingConfig();
  if (!config.builderReady || !config.clobReady) {
    throw new Error(config.missingSetupReason ?? "Trading configuration is unavailable.");
  }
  const status = await getDepositWalletStatus(input.address as Address, input.publicClient as PublicClient);
  let depositWalletAddress: string = status.depositWallet;
  if (!status.initialized) {
    if (!config.gaslessReady) {
      throw new Error(config.missingSetupReason ?? "Gasless trading is not configured on server.");
    }
    input.onProgress?.("initializing-trading-wallet");
    const relayClient = createRelayClient(input.walletClient as WalletClient);
    depositWalletAddress = await ensureDepositWalletDeployed(relayClient);
  }

  await ensureTradingSession(input.walletClient as WalletClient, 137, {
    tradingWalletAddress: depositWalletAddress,
    signatureType: 3,
  });

  input.onProgress?.("checking-balance");
  let account = await loadPolymarketAccount({
    walletClient: input.walletClient as WalletClient,
    address: input.address,
    tradingWalletAddress: depositWalletAddress,
    signatureType: 3,
  });
  const balance = account.balance;

  if (input.side === "Buy" && balance.usdc.balance <= 0) {
    throw new Error("Polymarket deposit wallet has no USDC balance. Fund the wallet before trading.");
  }
  if (status.initialized && (!balance.usdc.hasExchangeAllowance || !balance.usdc.hasCtfAllowance) && !config.gaslessReady) {
    throw new Error(config.missingSetupReason ?? "Gasless trading is not configured on server.");
  }

  const { exchange, conditionalTokens, collateral } = getPolymarketExchangeConfig(Boolean(input.negRisk));
  const relayClient = createRelayClient(input.walletClient as WalletClient);
  const required = BigInt(Math.ceil(Math.max(0, input.amount * input.price) * 1_000_000));

  if (input.side === "Buy" && !balance.usdc.hasExchangeAllowance) {
    input.onProgress?.("approving-trading");
    await ensureDepositWalletApprovals({
      client: relayClient,
      walletClient: input.walletClient as WalletClient,
      publicClient: input.publicClient as PublicClient,
      ownerAddress: input.address as `0x${string}`,
      token: collateral,
      spender: exchange,
      amount: required > BigInt(0) ? required : BigInt(1),
    });
  }

  if (!balance.usdc.hasCtfAllowance) {
    input.onProgress?.("approving-trading");
    await ensureDepositWalletConditionalApproval({
      client: relayClient,
      walletClient: input.walletClient as WalletClient,
      publicClient: input.publicClient as PublicClient,
      ownerAddress: input.address as `0x${string}`,
      token: conditionalTokens,
      operator: exchange,
    });
  }

  if (input.side === "Sell" && !balance.usdc.hasExchangeAllowance) {
    input.onProgress?.("approving-trading");
    await ensureDepositWalletApprovals({
      client: relayClient,
      walletClient: input.walletClient as WalletClient,
      publicClient: input.publicClient as PublicClient,
      ownerAddress: input.address as `0x${string}`,
      token: collateral,
      spender: exchange,
      amount: required > BigInt(0) ? required : BigInt(1),
    });
  }

  if (input.side === "Sell" && !balance.usdc.hasCtfAllowance) {
    input.onProgress?.("approving-trading");
    await ensureDepositWalletConditionalApproval({
      client: relayClient,
      walletClient: input.walletClient as WalletClient,
      publicClient: input.publicClient as PublicClient,
      ownerAddress: input.address as `0x${string}`,
      token: conditionalTokens,
      operator: exchange,
    });
  }

  if (!balance.usdc.hasExchangeAllowance) {
    await syncBalanceAllowance({
      signatureType: 3,
      tradingWalletAddress: depositWalletAddress as `0x${string}`,
      assetType: "COLLATERAL",
      tokenId: input.tokenId,
      walletClient: input.walletClient as WalletClient,
      address: input.address as `0x${string}`,
      chainId: 137,
    });
  }
  if (!balance.usdc.hasCtfAllowance) {
    await syncBalanceAllowance({
      signatureType: 3,
      tradingWalletAddress: depositWalletAddress as `0x${string}`,
      assetType: "CONDITIONAL",
      tokenId: input.tokenId,
      walletClient: input.walletClient as WalletClient,
      address: input.address as `0x${string}`,
      chainId: 137,
    });
  }
  if (!balance.usdc.hasExchangeAllowance || !balance.usdc.hasCtfAllowance) {
    account = await loadPolymarketAccount({
      walletClient: input.walletClient as WalletClient,
      address: input.address,
      tradingWalletAddress: depositWalletAddress,
      signatureType: 3,
    });
  }

  return {
    depositWalletAddress,
    depositWalletInitialized: true,
    balance: account.balance,
    accountResponse: account.response,
  } satisfies TradeSetupResult;
}
