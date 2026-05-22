import { createHmac } from "node:crypto";
import { POLYMARKET_CLOB_URL } from "@/lib/polymarket/client";
import { logInfo } from "./logger";
import { getSession, isSessionExpired } from "./session";
import { requireBuilderCode } from "./polymarketRuntimeConfig";

export const getServerBuilderCode = () => {
  return requireBuilderCode();
};

export const getPolymarketServerCreds = async () => {
  const session = await getSession();
  if (isSessionExpired(session) || !session.l2 || !session.walletAddress) {
    throw new Error("Trading session is not initialized. Reconnect your wallet and approve the trading session prompt.");
  }
  return {
    address: session.walletAddress,
    key: session.l2.apiKey,
    secret: session.l2.secret,
    passphrase: session.l2.passphrase,
    tradingWalletAddress: session.tradingWalletAddress ?? null,
    signatureType: session.signatureType ?? null,
  };
};

export const isInvalidPolymarketAuthError = (value: unknown) => {
  const message = value instanceof Error ? value.message : String(value ?? "");
  return /Unauthorized\/Invalid api key|invalid authorization|authorization expired/i.test(message);
};

const decodeBase64Url = (secret: string) => {
  const normalized = secret.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64");
};

export async function buildL2Headers(args: {
  method: string;
  requestPath: string;
  body?: string;
  route?: string;
}) {
  const creds = await getPolymarketServerCreds();
  const timestamp = Math.floor(Date.now() / 1000);
  const body = args.body ?? "";
  const message = `${timestamp}${args.method}${args.requestPath}${body}`;
  const signature = createHmac("sha256", decodeBase64Url(creds.secret))
    .update(message)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  const headers = {
    POLY_ADDRESS: creds.address,
    POLY_SIGNATURE: signature,
    POLY_TIMESTAMP: `${timestamp}`,
    POLY_API_KEY: creds.key,
    POLY_PASSPHRASE: creds.passphrase,
  };

  if (args.route) {
    logInfo("api.polymarket.auth", "l2_headers_built", {
      route: args.route,
      clobHost: POLYMARKET_CLOB_URL,
      connectedWallet: creds.address,
      sessionWallet: creds.tradingWalletAddress ?? creds.address,
      apiKey: redactCredential(creds.key),
      signatureType: creds.signatureType ?? null,
      funderAddress: creds.tradingWalletAddress ?? null,
    });
  }

  return headers;
}

export const redactCredential = (value: string | undefined) =>
  value ? `${value.slice(0, 6)}...${value.slice(-4)}` : null;
