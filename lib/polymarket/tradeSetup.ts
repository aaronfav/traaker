import type { Address, PublicClient, WalletClient } from "viem";
import { getDepositWalletStatus } from "./depositWallet";
import { ensureTradingSession } from "./tradeService";
import {
  createRelayClient,
  deploySafeIfNeeded,
  ensureDepositWalletApprovals,
  ensureDepositWalletConditionalApproval,
  ensureDepositWalletDeployed,
  ensureApprovals,
  ensureOperatorApproval,
  getPolymarketExchangeConfig,
  loadStoredProxyAddress,
  storeProxyAddress,
} from "./relayer";
import type { PortfolioBalanceState } from "./types";

export type TradingWalletMode = "legacy-proxy" | "deposit-wallet";

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
  proxyWalletAddress: string | null;
  tradingWalletAddress: string;
  signatureType: 2 | 3;
  walletMode: TradingWalletMode;
  balance: PortfolioBalanceState | null;
  accountResponse: unknown;
};

export type TradingWalletContext = {
  depositWalletAddress: string;
  depositWalletInitialized: boolean;
  proxyWalletAddress: string;
  proxyDeployed: boolean | null;
  walletMode: TradingWalletMode;
  tradingWalletAddress: string;
  signatureType: 2 | 3;
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

export async function resolveTradingWalletContext(input: {
  walletClient?: WalletClient | null;
  address?: Address | null;
  publicClient?: PublicClient | null;
}) {
  if (!input.walletClient || !input.address || !input.publicClient) {
    throw new Error("Trading wallet address unavailable.");
  }
  const relayClient = createRelayClient(input.walletClient);
  const depositWalletStatus = await getDepositWalletStatus(input.address as Address, input.publicClient);
  const cachedProxy = loadStoredProxyAddress(input.address);
  const expectedProxyAddress = await (relayClient as unknown as { getExpectedSafe: () => Promise<string> }).getExpectedSafe();
  let proxyWalletAddress = cachedProxy ?? expectedProxyAddress;

  let proxyDeployed: boolean | null = null;
  try {
    proxyDeployed = await relayClient.getDeployed(proxyWalletAddress);
    if (!proxyDeployed && cachedProxy && proxyWalletAddress !== expectedProxyAddress) {
      const expectedDeployed = await relayClient.getDeployed(expectedProxyAddress);
      if (expectedDeployed) {
        proxyWalletAddress = expectedProxyAddress;
        proxyDeployed = true;
      }
    }
    if (proxyDeployed) {
      storeProxyAddress(input.address, proxyWalletAddress);
    }
  } catch {
    proxyDeployed = null;
  }

  let walletMode: TradingWalletMode | null = null;
  if (proxyDeployed === true) {
    walletMode = "legacy-proxy";
  } else if (depositWalletStatus.initialized === true) {
    walletMode = "deposit-wallet";
  } else if (proxyDeployed === false) {
    walletMode = "deposit-wallet";
  }

  if (!walletMode) {
    throw new Error("Trading wallet address unavailable.");
  }

  const tradingWalletAddress = walletMode === "legacy-proxy" ? proxyWalletAddress : depositWalletStatus.depositWallet;
  const signatureType: 2 | 3 = walletMode === "legacy-proxy" ? 2 : 3;

  if (!tradingWalletAddress) {
    throw new Error("Trading wallet address unavailable.");
  }

  return {
    relayClient,
    depositWalletAddress: depositWalletStatus.depositWallet,
    depositWalletInitialized: depositWalletStatus.initialized,
    proxyWalletAddress,
    proxyDeployed,
    walletMode,
    tradingWalletAddress,
    signatureType,
  } satisfies TradingWalletContext & { relayClient: ReturnType<typeof createRelayClient> };
}

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
      (data?.code === "AUTH_INVALID_SESSION" ||
        /unauthorized\/invalid api key|invalid authorization|authorization expired/i.test(
          `${data?.error ?? ""} ${data?.code ?? ""}`,
        )) &&
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
  signatureType: 2 | 3;
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
  const context = await resolveTradingWalletContext({
    walletClient: input.walletClient as WalletClient,
    address: input.address,
    publicClient: input.publicClient as PublicClient,
  });

  if (context.walletMode === "deposit-wallet" && !context.depositWalletInitialized) {
    if (!config.gaslessReady) {
      throw new Error(config.missingSetupReason ?? "Gasless trading is not configured on server.");
    }
    input.onProgress?.("initializing-trading-wallet");
    context.tradingWalletAddress = await ensureDepositWalletDeployed(context.relayClient);
    context.depositWalletInitialized = true;
  } else if (context.walletMode === "legacy-proxy" && context.proxyDeployed !== true) {
    if (!config.gaslessReady) {
      throw new Error(config.missingSetupReason ?? "Gasless trading is not configured on server.");
    }
    input.onProgress?.("initializing-trading-wallet");
    context.tradingWalletAddress = await deploySafeIfNeeded(context.relayClient, input.address);
    context.proxyDeployed = true;
  }

  await ensureTradingSession(input.walletClient as WalletClient, 137, {
    tradingWalletAddress: context.tradingWalletAddress,
    signatureType: context.signatureType,
  });

  const { exchange, conditionalTokens, collateral } = getPolymarketExchangeConfig(Boolean(input.negRisk));
  const required = BigInt(Math.ceil(Math.max(0, input.amount * input.price) * 1_000_000));
  if (context.walletMode === "legacy-proxy") {
    if (input.side === "Buy") {
      input.onProgress?.("approving-trading");
      await ensureApprovals({
        client: context.relayClient,
        publicClient: input.publicClient as PublicClient,
        ownerAddress: input.address as `0x${string}`,
        token: collateral,
        spender: exchange,
        amount: required > BigInt(0) ? required : BigInt(1),
      });
    }

    input.onProgress?.("approving-trading");
    await ensureOperatorApproval({
      client: context.relayClient,
      publicClient: input.publicClient as PublicClient,
      ownerAddress: input.address as `0x${string}`,
      token: conditionalTokens,
      operator: exchange,
    });

    if (input.side === "Sell") {
      input.onProgress?.("approving-trading");
      await ensureApprovals({
        client: context.relayClient,
        publicClient: input.publicClient as PublicClient,
        ownerAddress: input.address as `0x${string}`,
        token: collateral,
        spender: exchange,
        amount: required > BigInt(0) ? required : BigInt(1),
      });
    }

    if (input.side === "Sell") {
      input.onProgress?.("approving-trading");
      await ensureOperatorApproval({
        client: context.relayClient,
        publicClient: input.publicClient as PublicClient,
        ownerAddress: input.address as `0x${string}`,
        token: conditionalTokens,
        operator: exchange,
      });
    }
  } else {
    if (input.side === "Buy") {
      input.onProgress?.("approving-trading");
      await ensureDepositWalletApprovals({
        client: context.relayClient,
        walletClient: input.walletClient as WalletClient,
        publicClient: input.publicClient as PublicClient,
        ownerAddress: input.address as `0x${string}`,
        token: collateral,
        spender: exchange,
        amount: required > BigInt(0) ? required : BigInt(1),
      });
    }

    input.onProgress?.("approving-trading");
    await ensureDepositWalletConditionalApproval({
      client: context.relayClient,
      walletClient: input.walletClient as WalletClient,
      publicClient: input.publicClient as PublicClient,
      ownerAddress: input.address as `0x${string}`,
      token: conditionalTokens,
      operator: exchange,
    });

    if (input.side === "Sell") {
      input.onProgress?.("approving-trading");
      await ensureDepositWalletApprovals({
        client: context.relayClient,
        walletClient: input.walletClient as WalletClient,
        publicClient: input.publicClient as PublicClient,
        ownerAddress: input.address as `0x${string}`,
        token: collateral,
        spender: exchange,
        amount: required > BigInt(0) ? required : BigInt(1),
      });
    }

    if (input.side === "Sell") {
      input.onProgress?.("approving-trading");
      await ensureDepositWalletConditionalApproval({
        client: context.relayClient,
        walletClient: input.walletClient as WalletClient,
        publicClient: input.publicClient as PublicClient,
        ownerAddress: input.address as `0x${string}`,
        token: conditionalTokens,
        operator: exchange,
      });
    }
  }

  await syncBalanceAllowance({
    signatureType: context.signatureType,
    tradingWalletAddress: context.tradingWalletAddress as `0x${string}`,
    assetType: "COLLATERAL",
    tokenId: input.tokenId,
    walletClient: input.walletClient as WalletClient,
    address: input.address as `0x${string}`,
    chainId: 137,
  });
  await syncBalanceAllowance({
    signatureType: context.signatureType,
    tradingWalletAddress: context.tradingWalletAddress as `0x${string}`,
    assetType: "CONDITIONAL",
    tokenId: input.tokenId,
    walletClient: input.walletClient as WalletClient,
    address: input.address as `0x${string}`,
    chainId: 137,
  });

  return {
    depositWalletAddress: context.depositWalletAddress,
    depositWalletInitialized: context.depositWalletInitialized,
    proxyWalletAddress: context.proxyWalletAddress,
    tradingWalletAddress: context.tradingWalletAddress,
    signatureType: context.signatureType,
    walletMode: context.walletMode,
    balance: null,
    accountResponse: null,
  } satisfies TradeSetupResult;
}
