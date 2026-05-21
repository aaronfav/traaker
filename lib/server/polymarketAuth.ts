import "server-only";

import { createHmac } from "node:crypto";

export const getServerBuilderCode = () => {
  const builderCode = process.env.POLYMARKET_BUILDER_CODE?.trim();
  if (!builderCode || !/^0x[0-9a-fA-F]{64}$/.test(builderCode)) {
    throw new Error("POLYMARKET_BUILDER_CODE is missing or invalid. Expected bytes32 hex string.");
  }
  return builderCode;
};

export const getPolymarketServerCreds = () => {
  const address = process.env.POLYMARKET_ADDRESS?.trim();
  const key = process.env.POLYMARKET_API_KEY?.trim();
  const secret = process.env.POLYMARKET_SECRET?.trim();
  const passphrase = process.env.POLYMARKET_PASSPHRASE?.trim();
  if (!address || !key || !secret || !passphrase) {
    throw new Error("Missing POLYMARKET_ADDRESS, POLYMARKET_API_KEY, POLYMARKET_SECRET, or POLYMARKET_PASSPHRASE.");
  }
  return { address, key, secret, passphrase };
};

const decodeBase64Url = (secret: string) => {
  const normalized = secret.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64");
};

export function buildL2Headers(args: { method: string; requestPath: string; body?: string }) {
  const creds = getPolymarketServerCreds();
  const timestamp = Math.floor(Date.now() / 1000);
  const body = args.body ?? "";
  const message = `${timestamp}${args.method}${args.requestPath}${body}`;
  const signature = createHmac("sha256", decodeBase64Url(creds.secret))
    .update(message)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return {
    POLY_ADDRESS: creds.address,
    POLY_SIGNATURE: signature,
    POLY_TIMESTAMP: `${timestamp}`,
    POLY_API_KEY: creds.key,
    POLY_PASSPHRASE: creds.passphrase,
  };
}

export const redactCredential = (value: string | undefined) =>
  value ? `${value.slice(0, 6)}...${value.slice(-4)}` : null;
