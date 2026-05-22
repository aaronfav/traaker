import {
  CallType,
  buildDepositWalletCreateRequest,
  type DepositWalletCall,
  OperationType,
  RelayClient,
  RelayerTransactionState,
  RelayerTxType,
  type RelayerTransaction,
  type RelayerTransactionResponse,
} from "@polymarket/builder-relayer-client";
import { buildSafeCreateTransactionRequest } from "@polymarket/builder-relayer-client/dist/builder/create";
import { deriveSafe } from "@polymarket/builder-relayer-client/dist/builder/derive";
import { buildProxyTransactionRequest } from "@polymarket/builder-relayer-client/dist/builder/proxy";
import { buildSafeTransactionRequest } from "@polymarket/builder-relayer-client/dist/builder/safe";
import { encodeProxyTransactionData } from "@polymarket/builder-relayer-client/dist/encode";
import {
  isDepositWalletContractConfigValid,
  isProxyContractConfigValid,
  isSafeContractConfigValid,
} from "@polymarket/builder-relayer-client/dist/config";
import { encodeFunctionData, erc1155Abi as viemErc1155Abi, erc20Abi } from "viem";
import { zeroAddress } from "viem";
import { getContractConfig } from "@polymarket/clob-client-v2";
import type { PublicClient, WalletClient } from "viem";

const DEFAULT_RELAYER_URL = "https://relayer-v2.polymarket.com/";
const RELAYER_ENV_URL = process.env.NEXT_PUBLIC_POLY_RELAYER_URL;
const CHAIN_ID = 137;
const HEX_65_BYTE_SIGNATURE_RE = /^0x[0-9a-fA-F]{130}$/;
const STORAGE_PREFIX = "traak:polymarket:safe:";

const getRelayerUrl = () => {
  if (RELAYER_ENV_URL && /^https?:\/\//.test(RELAYER_ENV_URL)) {
    return RELAYER_ENV_URL;
  }
  return DEFAULT_RELAYER_URL;
};

export const createRelayClient = (walletClient: WalletClient, txType: RelayerTxType = RelayerTxType.SAFE) =>
  new RelayClient(getRelayerUrl(), CHAIN_ID, walletClient, undefined, txType);

const storageKey = (address: string) => `${STORAGE_PREFIX}${address.toLowerCase()}`;

export const loadStoredProxyAddress = (address: string) => {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(storageKey(address));
};

export const storeProxyAddress = (address: string, proxy: string) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey(address), proxy);
};

type RelayerSubmitResponse = {
  ok?: boolean;
  code?: string;
  transactionID?: string;
  transactionId?: string;
  id?: string;
  state?: string;
  transactionHash?: string;
  hash?: string;
  error?: string;
  details?: unknown;
};

const submitRelayerRequest = async (request: object): Promise<RelayerSubmitResponse> => {
  const res = await fetch("/api/polymarket/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  const data = (await res.json().catch(() => null)) as RelayerSubmitResponse | null;
  if (!res.ok || !data) {
    const upstream =
      data?.details && typeof data.details === "object"
        ? (data.details as { data?: { error?: string }; error?: string })
        : null;
    const message =
      upstream?.data?.error ??
      upstream?.error ??
      data?.error ??
      `Relayer request failed (${res.status}).`;
    if (data?.code === "GASLESS_TRADING_NOT_CONFIGURED" || /gasless trading is not configured/i.test(message)) {
      throw new Error("Gasless trading is not configured on server.");
    }
    throw new Error(message);
  }
  return data;
};

const buildRelayerResponse = (client: RelayClient, response: RelayerSubmitResponse): RelayerTransactionResponse => {
  const transactionID = response.transactionID ?? response.transactionId ?? response.id;
  if (!transactionID) {
    throw new Error("Relayer response missing transaction id.");
  }
  const transactionHash = response.transactionHash ?? response.hash ?? "";
  return {
    transactionID,
    transactionHash,
    hash: transactionHash,
    state: response.state ?? RelayerTransactionState.STATE_NEW,
    getTransaction: () => client.getTransaction(transactionID),
    wait: () =>
      client.pollUntilState(
        transactionID,
        [RelayerTransactionState.STATE_MINED, RelayerTransactionState.STATE_CONFIRMED],
        RelayerTransactionState.STATE_FAILED,
        100,
      ) as Promise<RelayerTransaction | undefined>,
  };
};

const waitForRelayerResponse = async (response: RelayerTransactionResponse, failureMessage: string) => {
  const result = await response.wait();
  if (!result || result.state === RelayerTransactionState.STATE_FAILED) {
    throw new Error(failureMessage);
  }
  return result;
};

export const deriveDepositWalletAddress = async (client: RelayClient) => client.deriveDepositWalletAddress();

const getClientSigner = (client: RelayClient) => {
  if (!client.signer) {
    throw new Error("Relayer signer unavailable.");
  }
  return client.signer;
};

const getExpectedSafe = async (client: RelayClient) => {
  const signer = getClientSigner(client);
  const address = await signer.getAddress();
  return deriveSafe(address, client.contractConfig.SafeContracts.SafeFactory);
};

const buildExecuteRequest = async ({
  client,
  txns,
  metadata,
  txType,
}: {
  client: RelayClient;
  txns: Array<{ to: string; data: string; value?: string }>;
  metadata?: string;
  txType: RelayerTxType;
}) => {
  const signer = getClientSigner(client);
  const from = await signer.getAddress();
  if (txType === RelayerTxType.PROXY) {
    const relayPayload = await client.getRelayPayload(from, "PROXY");
    const proxyContractConfig = client.contractConfig.ProxyContracts;
    if (!isProxyContractConfigValid(proxyContractConfig)) {
      throw new Error("Relayer proxy config unsupported on Polygon.");
    }
    return buildProxyTransactionRequest(
      signer,
      {
        from,
        gasPrice: "0",
        data: encodeProxyTransactionData(
          txns.map((txn) => ({
            to: txn.to,
            typeCode: CallType.Call,
            data: txn.data,
            value: txn.value ?? "0",
          })),
        ),
        relay: relayPayload.address,
        nonce: relayPayload.nonce,
      },
      proxyContractConfig,
      metadata,
    );
  }

  const safe = await getExpectedSafe(client);
  const deployed = await client.getDeployed(safe);
  if (!deployed) {
    throw new Error("Safe is not deployed.");
  }
  const noncePayload = await client.getNonce(from, "SAFE");
  const safeContractConfig = client.contractConfig.SafeContracts;
  if (!isSafeContractConfigValid(safeContractConfig)) {
    throw new Error("Relayer Safe config unsupported on Polygon.");
  }
  return buildSafeTransactionRequest(
    signer,
    {
      transactions: txns.map((txn) => ({
        to: txn.to,
        operation: OperationType.Call,
        data: txn.data,
        value: txn.value ?? "0",
      })),
      from,
      nonce: noncePayload.nonce,
      chainId: CHAIN_ID,
    },
    safeContractConfig,
    metadata,
  );
};

export const executeRelayerTransactions = async ({
  client,
  txns,
  metadata,
  txType = RelayerTxType.SAFE,
}: {
  client: RelayClient;
  txns: Array<{ to: string; data: string; value?: string }>;
  metadata?: string;
  txType?: RelayerTxType;
}) => {
  const request = await buildExecuteRequest({ client, txns, metadata, txType });
  const response = buildRelayerResponse(client, await submitRelayerRequest(request));
  await waitForRelayerResponse(response, "Relayer transaction failed.");
  return response;
};

export const deploySafeIfNeeded = async (client: RelayClient, eoaAddress: string) => {
  const cached = loadStoredProxyAddress(eoaAddress);
  const expectedSafe = await getExpectedSafe(client);
  const candidate = cached ?? expectedSafe;
  const deployed = await client.getDeployed(candidate);
  if (deployed) {
    storeProxyAddress(eoaAddress, candidate);
    return candidate;
  }
  const signer = getClientSigner(client);
  const safeContractConfig = client.contractConfig.SafeContracts;
  if (!isSafeContractConfigValid(safeContractConfig)) {
    throw new Error("Relayer Safe config unsupported on Polygon.");
  }
  const request = await buildSafeCreateTransactionRequest(
    signer,
    safeContractConfig,
    {
      from: eoaAddress,
      chainId: CHAIN_ID,
      paymentToken: zeroAddress,
      payment: "0",
      paymentReceiver: zeroAddress,
    },
  );
  const response = buildRelayerResponse(client, await submitRelayerRequest(request));
  const result = await response.wait();
  const proxy = result?.proxyAddress ?? expectedSafe;
  storeProxyAddress(eoaAddress, proxy);
  return proxy;
};

export const ensureDepositWalletDeployed = async (client: RelayClient) => {
  const walletAddress = await client.deriveDepositWalletAddress();
  const alreadyDeployed = await client.getDeployed(walletAddress, "WALLET");
  if (alreadyDeployed) {
    return walletAddress;
  }
  const depositWalletConfig = client.contractConfig.DepositWalletContracts;
  if (!isDepositWalletContractConfigValid(depositWalletConfig)) {
    throw new Error("Deposit wallet config unsupported on Polygon.");
  }
  const signer = client.signer;
  if (!signer) {
    throw new Error("Relayer signer unavailable.");
  }
  const owner = await signer.getAddress();
  const request = buildDepositWalletCreateRequest(owner, depositWalletConfig);
  const response = buildRelayerResponse(client, await submitRelayerRequest(request));
  await waitForRelayerResponse(response, "Deposit wallet deployment failed.");
  const deployed = await client.getDeployed(walletAddress, "WALLET");
  if (!deployed) {
    throw new Error("Deposit wallet deployment was not confirmed.");
  }
  return walletAddress;
};

export const executeDepositWalletBatch = async ({
  client,
  walletClient,
  ownerAddress,
  walletAddress,
  calls,
  deadline,
}: {
  client: RelayClient;
  walletClient: WalletClient;
  ownerAddress: `0x${string}`;
  walletAddress: string;
  calls: DepositWalletCall[];
  deadline?: string;
}) => {
  const depositWalletConfig = client.contractConfig.DepositWalletContracts;
  if (!isDepositWalletContractConfigValid(depositWalletConfig)) {
    throw new Error("Deposit wallet config unsupported on Polygon.");
  }
  const noncePayload = await client.getNonce(ownerAddress, "WALLET");
  const resolvedDeadline = deadline ?? Math.floor(Date.now() / 1000 + 10 * 60).toString();
  if (BigInt(resolvedDeadline) <= BigInt(Math.floor(Date.now() / 1000))) {
    throw new Error("Deposit wallet batch deadline must be in the future.");
  }
  const signature = await walletClient.signTypedData({
    account: ownerAddress,
    domain: {
      name: "DepositWallet",
      version: "1",
      chainId: CHAIN_ID,
      verifyingContract: walletAddress as `0x${string}`,
    },
    types: {
      Call: [
        { name: "target", type: "address" },
        { name: "value", type: "uint256" },
        { name: "data", type: "bytes" },
      ],
      Batch: [
        { name: "wallet", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
        { name: "calls", type: "Call[]" },
      ],
    },
    primaryType: "Batch",
    message: {
      wallet: walletAddress as `0x${string}`,
      nonce: BigInt(noncePayload.nonce),
      deadline: BigInt(resolvedDeadline),
      calls: calls.map((call) => ({
        target: call.target as `0x${string}`,
        value: BigInt(call.value),
        data: call.data as `0x${string}`,
      })),
    },
  });
  if (!HEX_65_BYTE_SIGNATURE_RE.test(signature)) {
    throw new Error("Deposit wallet WALLET batch signature must be a 65-byte EIP-712 signature.");
  }
  const request = {
    type: "WALLET",
    from: ownerAddress,
    to: depositWalletConfig.DepositWalletFactory,
    nonce: noncePayload.nonce,
    signature,
    depositWalletParams: {
      depositWallet: walletAddress,
      deadline: resolvedDeadline,
      calls,
    },
  };
  const response = buildRelayerResponse(client, await submitRelayerRequest(request));
  await waitForRelayerResponse(response, "Deposit wallet batch failed.");
  return response;
};

export const ensureDepositWalletApprovals = async ({
  client,
  walletClient,
  publicClient,
  ownerAddress,
  token,
  spender,
  amount,
}: {
  client: RelayClient;
  walletClient: WalletClient;
  publicClient: PublicClient;
  ownerAddress: `0x${string}`;
  token: string;
  spender: string;
  amount: bigint;
}) => {
  const walletAddress = await ensureDepositWalletDeployed(client);
  const allowance = await publicClient.readContract({
    address: token as `0x${string}`,
    abi: erc20Abi,
    functionName: "allowance",
    args: [walletAddress as `0x${string}`, spender as `0x${string}`],
  });
  if (typeof allowance === "bigint" && allowance >= amount) {
    return walletAddress;
  }
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [spender as `0x${string}`, amount],
  });
  await executeDepositWalletBatch({
    client,
    walletClient,
    ownerAddress,
    walletAddress,
    calls: [{ target: token, data, value: "0" }],
  });
  return walletAddress;
};

export const ensureDepositWalletConditionalApproval = async ({
  client,
  walletClient,
  publicClient,
  ownerAddress,
  token,
  operator,
}: {
  client: RelayClient;
  walletClient: WalletClient;
  publicClient: PublicClient;
  ownerAddress: `0x${string}`;
  token: string;
  operator: string;
}) => {
  const walletAddress = await ensureDepositWalletDeployed(client);
  const approved = await publicClient.readContract({
    address: token as `0x${string}`,
    abi: viemErc1155Abi,
    functionName: "isApprovedForAll",
    args: [walletAddress as `0x${string}`, operator as `0x${string}`],
  });
  if (approved === true) {
    return walletAddress;
  }
  const data = encodeFunctionData({
    abi: viemErc1155Abi,
    functionName: "setApprovalForAll",
    args: [operator as `0x${string}`, true],
  });
  await executeDepositWalletBatch({
    client,
    walletClient,
    ownerAddress,
    walletAddress,
    calls: [{ target: token, data, value: "0" }],
  });
  return walletAddress;
};

export const ensureApprovals = async ({
  client,
  publicClient,
  ownerAddress,
  token,
  spender,
  amount,
}: {
  client: RelayClient;
  publicClient: PublicClient;
  ownerAddress: `0x${string}`;
  token: string;
  spender: string;
  amount: bigint;
}) => {
  const walletAddress = await deploySafeIfNeeded(client, ownerAddress);
  const allowance = await publicClient.readContract({
    address: token as `0x${string}`,
    abi: erc20Abi,
    functionName: "allowance",
    args: [walletAddress as `0x${string}`, spender as `0x${string}`],
  });
  if (typeof allowance === "bigint" && allowance >= amount) {
    return walletAddress;
  }
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [spender as `0x${string}`, amount],
  });
  await executeRelayerTransactions({
    client,
    txns: [{ to: token, data, value: "0" }],
    metadata: "Approve collateral",
    txType: RelayerTxType.PROXY,
  });
  return walletAddress;
};

export const ensureOperatorApproval = async ({
  client,
  publicClient,
  ownerAddress,
  token,
  operator,
}: {
  client: RelayClient;
  publicClient: PublicClient;
  ownerAddress: `0x${string}`;
  token: string;
  operator: string;
}) => {
  const walletAddress = await deploySafeIfNeeded(client, ownerAddress);
  const approved = await publicClient.readContract({
    address: token as `0x${string}`,
    abi: viemErc1155Abi,
    functionName: "isApprovedForAll",
    args: [walletAddress as `0x${string}`, operator as `0x${string}`],
  });
  if (approved === true) {
    return walletAddress;
  }
  const data = encodeFunctionData({
    abi: viemErc1155Abi,
    functionName: "setApprovalForAll",
    args: [operator as `0x${string}`, true],
  });
  await executeRelayerTransactions({
    client,
    txns: [{ to: token, data, value: "0" }],
    metadata: "Approve conditional tokens",
    txType: RelayerTxType.PROXY,
  });
  return walletAddress;
};

export const getPolymarketExchangeConfig = (negRisk = false) => {
  const config = getContractConfig(CHAIN_ID);
  return {
    collateral: config.collateral,
    conditionalTokens: config.conditionalTokens,
    exchange: negRisk ? config.negRiskExchangeV2 ?? config.negRiskExchange : config.exchangeV2 ?? config.exchange,
  };
};
