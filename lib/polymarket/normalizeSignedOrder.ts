import { getAddress, isAddress } from "viem";
import { z } from "zod";

const DECIMAL_STRING_RE = /^[0-9]+$/;
const HEX_STRING_RE = /^0x[0-9a-fA-F]+$/;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000";

const decimalStringSchema = z.string().regex(DECIMAL_STRING_RE);
const addressSchema = z.string().refine((value) => isAddress(value), "Invalid address.");
const signatureSchema = z
  .string()
  .regex(HEX_STRING_RE)
  .refine((value) => (value.length - 2) % 2 === 0, "Signature hex length invalid.");

export const SignedOrderSchema = z.object({
  salt: decimalStringSchema,
  maker: addressSchema,
  signer: addressSchema,
  taker: addressSchema,
  tokenId: decimalStringSchema,
  makerAmount: decimalStringSchema,
  takerAmount: decimalStringSchema,
  side: z.enum(["BUY", "SELL"]),
  signatureType: z.number().int().min(0).max(255),
  timestamp: decimalStringSchema,
  expiration: decimalStringSchema,
  metadata: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  builder: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  signature: signatureSchema,
});

export type NormalizedSignedOrder = z.infer<typeof SignedOrderSchema>;

const normalizeAddress = (value: unknown, field: string) => {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required.`);
  if (!isAddress(value)) throw new Error(`${field} is not a valid address.`);
  return getAddress(value);
};

const toDecimalString = (value: unknown, field: string) => {
  if (value == null) throw new Error(`${field} is required.`);
  if (typeof value === "string") {
    if (DECIMAL_STRING_RE.test(value)) return value;
    if (HEX_STRING_RE.test(value)) return BigInt(value).toString();
  }
  if (typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0) return String(value);
  if (typeof value === "bigint" && value >= BigInt(0)) return value.toString();
  if (value && typeof (value as { toString?: unknown }).toString === "function") {
    const text = String((value as { toString: () => string }).toString());
    if (DECIMAL_STRING_RE.test(text)) return text;
    if (HEX_STRING_RE.test(text)) return BigInt(text).toString();
  }
  throw new Error(`${field} must be a decimal-compatible value.`);
};

const toNumber = (value: unknown, field: string) => {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "bigint" && value <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value);
  if (typeof value === "string" && DECIMAL_STRING_RE.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  throw new Error(`${field} must be a numeric value.`);
};

const normalizeSide = (value: unknown) => {
  if (value === "BUY" || value === "0" || value === 0) return "BUY";
  if (value === "SELL" || value === "1" || value === 1) return "SELL";
  throw new Error("side must be BUY or SELL.");
};

const normalizeBytes32 = (value: unknown, field: string) => {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${field} must be a bytes32 hex string.`);
  return value;
};

const normalizeSignature = (value: unknown) => {
  if (typeof value !== "string" || !HEX_STRING_RE.test(value) || (value.length - 2) % 2 !== 0) {
    throw new Error("signature must be a valid 0x-prefixed hex string.");
  }
  return value;
};

export const normalizeSignedOrder = (input: unknown): NormalizedSignedOrder => {
  if (!input || typeof input !== "object") throw new Error("Signed order must be an object.");
  const raw = input as Record<string, unknown>;
  const normalized: NormalizedSignedOrder = {
    salt: toDecimalString(raw.salt, "salt"),
    maker: normalizeAddress(raw.maker, "maker"),
    signer: normalizeAddress(raw.signer, "signer"),
    taker: normalizeAddress(raw.taker ?? ZERO_ADDRESS, "taker"),
    tokenId: toDecimalString(raw.tokenId ?? raw.tokenID, "tokenId"),
    makerAmount: toDecimalString(raw.makerAmount, "makerAmount"),
    takerAmount: toDecimalString(raw.takerAmount, "takerAmount"),
    side: normalizeSide(raw.side),
    signatureType: toNumber(raw.signatureType, "signatureType"),
    timestamp: toDecimalString(raw.timestamp, "timestamp"),
    expiration: toDecimalString(raw.expiration, "expiration"),
    metadata: normalizeBytes32(raw.metadata ?? ZERO_BYTES32, "metadata"),
    builder: normalizeBytes32(raw.builder, "builder"),
    signature: normalizeSignature(raw.signature),
  };

  const parsed = SignedOrderSchema.safeParse(normalized);
  if (!parsed.success) {
    throw new Error(`Invalid signed order: ${parsed.error.issues.map((issue) => issue.message).join(", ")}`);
  }
  return parsed.data;
};
