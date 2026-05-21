import {
  Chain,
  ClobClient,
  SignatureTypeV2,
  type ApiKeyCreds,
  type ClobClientOptions,
} from "@polymarket/clob-client-v2";
import type { WalletClient } from "viem";

export const POLYGON_CHAIN_ID = Chain.POLYGON;
export const POLYMARKET_HOST = process.env.POLYMARKET_HOST || "https://clob.polymarket.com";

export type PolymarketClientInput = {
  signer?: WalletClient;
  creds?: ApiKeyCreds;
  signatureType?: SignatureTypeV2;
  funderAddress?: string;
  builderCode?: string;
  throwOnError?: boolean;
};

export function getBuilderCode() {
  return "";
}

export function createPolymarketClient(input: PolymarketClientInput = {}) {
  const builderCode = input.builderCode ?? getBuilderCode();
  const options: ClobClientOptions = {
    host: POLYMARKET_HOST,
    chain: POLYGON_CHAIN_ID,
    signer: input.signer,
    creds: input.creds,
    signatureType: input.signatureType ?? SignatureTypeV2.POLY_1271,
    funderAddress: input.funderAddress,
    useServerTime: true,
    retryOnError: true,
    throwOnError: input.throwOnError ?? true,
    ...(builderCode ? { builderConfig: { builderCode } } : {}),
  };

  return new ClobClient(options);
}

export async function createSignerClient(input: {
  signer: WalletClient;
  signatureType?: SignatureTypeV2;
  funderAddress?: string;
  builderCode?: string;
}) {
  return createPolymarketClient({
    signer: input.signer,
    signatureType: input.signatureType ?? SignatureTypeV2.POLY_1271,
    funderAddress: input.funderAddress,
    builderCode: input.builderCode,
  });
}

export { OrderType, Side, SignatureTypeV2, AssetType } from "@polymarket/clob-client-v2";
export type { ApiKeyCreds, BalanceAllowanceResponse, OpenOrder, Trade } from "@polymarket/clob-client-v2";
