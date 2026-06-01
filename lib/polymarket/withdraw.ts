import { RelayerTxType } from "@polymarket/builder-relayer-client";
import { encodeFunctionData, erc20Abi, isAddress, parseUnits, type Address, type PublicClient, type WalletClient } from "viem";

import { executeDepositWalletBatch, executeRelayerTransactions, getPolymarketExchangeConfig } from "./relayer";
import { ensureTradingSession } from "./tradeService";
import { resolveTradingWalletContext } from "./tradeSetup";

type ResolvedTradingWalletContext = Awaited<ReturnType<typeof resolveTradingWalletContext>> & {
  relayClient: Parameters<typeof executeRelayerTransactions>[0]["client"];
};

export type WithdrawRequest = {
  walletClient: WalletClient;
  publicClient: PublicClient;
  address: Address;
  destinationAddress: string;
  amount: string;
  availableBalanceRaw?: string | null;
};

export type WithdrawResult = {
  amountRaw: string;
  destinationAddress: string;
  transactionHash: string;
  transactionId: string;
  tradingWalletAddress: string;
  walletMode: ResolvedTradingWalletContext["walletMode"];
};

function parseWithdrawAmount(amount: string) {
  const trimmed = amount.trim();
  if (!trimmed) {
    throw new Error("Enter an amount to withdraw.");
  }

  let parsed: bigint;
  try {
    parsed = parseUnits(trimmed, 6);
  } catch {
    throw new Error("Enter a valid withdrawal amount with up to 6 decimals.");
  }

  if (parsed <= BigInt(0)) {
    throw new Error("Withdrawal amount must be greater than zero.");
  }

  return parsed;
}

export async function withdrawFromTradingWallet(input: WithdrawRequest): Promise<WithdrawResult> {
  if (!isAddress(input.destinationAddress)) {
    throw new Error("Enter a valid destination wallet address.");
  }

  const amountRaw = parseWithdrawAmount(input.amount);
  const availableRaw = input.availableBalanceRaw?.trim() ?? null;
  if (availableRaw) {
    try {
      if (amountRaw > BigInt(availableRaw)) {
        throw new Error("Withdrawal amount exceeds available balance.");
      }
    } catch (error) {
      if (error instanceof Error && error.message === "Withdrawal amount exceeds available balance.") {
        throw error;
      }
      // If the balance payload is malformed, skip the local balance guard and let the wallet flow continue.
    }
  }

  const context = (await resolveTradingWalletContext({
    walletClient: input.walletClient,
    address: input.address,
    publicClient: input.publicClient,
  })) as ResolvedTradingWalletContext;

  if (context.walletMode === "deposit-wallet" && !context.depositWalletInitialized) {
    throw new Error("Deposit wallet is not initialized yet.");
  }

  await ensureTradingSession(input.walletClient, 137, {
    tradingWalletAddress: context.tradingWalletAddress,
    signatureType: context.signatureType,
  });

  const { collateral } = getPolymarketExchangeConfig(false);
  const transferData = encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [input.destinationAddress as Address, amountRaw],
  });

  if (context.walletMode === "deposit-wallet") {
    const response = await executeDepositWalletBatch({
      client: context.relayClient,
      walletClient: input.walletClient,
      ownerAddress: input.address,
      walletAddress: context.depositWalletAddress,
      calls: [{ target: collateral, data: transferData, value: "0" }],
    });

    return {
      amountRaw: amountRaw.toString(),
      destinationAddress: input.destinationAddress,
      transactionHash: response.transactionHash ?? response.hash ?? "",
      transactionId: response.transactionID,
      tradingWalletAddress: context.tradingWalletAddress,
      walletMode: context.walletMode,
    };
  }

  const response = await executeRelayerTransactions({
    client: context.relayClient,
    txns: [{ to: collateral, data: transferData, value: "0" }],
    metadata: "Withdraw collateral",
    txType: RelayerTxType.PROXY,
  });

  return {
    amountRaw: amountRaw.toString(),
    destinationAddress: input.destinationAddress,
    transactionHash: response.transactionHash ?? response.hash ?? "",
    transactionId: response.transactionID,
    tradingWalletAddress: context.tradingWalletAddress,
    walletMode: context.walletMode,
  };
}
