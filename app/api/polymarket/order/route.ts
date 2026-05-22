import { NextResponse } from "next/server";
import { z } from "zod";
import { POLYMARKET_CLOB_URL } from "@/lib/polymarket/client";
import { normalizeSignedOrder } from "@/lib/polymarket/normalizeSignedOrder";
import { buildL2Headers, getPolymarketServerCreds, getServerBuilderCode, isInvalidPolymarketAuthError, redactCredential } from "@/lib/server/polymarketAuth";
import { clearSession, getSession } from "@/lib/server/session";
import { logError, logInfo } from "@/lib/server/logger";
import { isRealTradingEnabled } from "@/lib/server/tradingConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const orderTypeSchema = z.enum(["FAK", "FOK", "GTC", "GTD"]);
const signedOrderSchema = z.object({
  salt: z.union([z.string(), z.number()]),
  maker: z.string(),
  signer: z.string(),
  taker: z.string().optional(),
  tokenId: z.union([z.string(), z.number()]).optional(),
  tokenID: z.union([z.string(), z.number()]).optional(),
  makerAmount: z.union([z.string(), z.number()]),
  takerAmount: z.union([z.string(), z.number()]),
  side: z.union([z.string(), z.number()]),
  signatureType: z.union([z.string(), z.number()]),
  timestamp: z.union([z.string(), z.number()]),
  expiration: z.union([z.string(), z.number()]),
  metadata: z.string(),
  builder: z.string(),
  signature: z.string(),
});
const payloadSchema = z.object({
  order: signedOrderSchema,
  orderType: orderTypeSchema.optional(),
  execution: orderTypeSchema.optional(),
  tradeMode: z.enum(["limit", "market"]).optional(),
  signatureType: z.number().optional(),
  funderAddress: z.string().optional(),
  authAddress: z.string().optional(),
  clientMeta: z.record(z.string(), z.unknown()).optional(),
});

const normalizeSide = (value: string | number) => {
  if (typeof value === "number") return String(value);
  const normalized = value.trim().toLowerCase();
  if (normalized === "buy") return "BUY";
  if (normalized === "sell") return "SELL";
  return value;
};

const sameAddress = (left: string | null | undefined, right: string | null | undefined) =>
  Boolean(left && right && left.toLowerCase() === right.toLowerCase());

export async function POST(request: Request) {
  if (!isRealTradingEnabled()) {
    return NextResponse.json(
      { ok: false, error: "Real trading is disabled. Set ENABLE_REAL_TRADING=true only after production validation." },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (Array.from(request.headers.keys()).some((key) => key.toLowerCase().startsWith("poly_"))) {
    return NextResponse.json({ ok: false, error: "Unexpected auth headers." }, { status: 400 });
  }

  let parsed: z.infer<typeof payloadSchema>;
  try {
    parsed = payloadSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid signed order payload." }, { status: 400 });
  }

  let normalizedOrder: ReturnType<typeof normalizeSignedOrder>;
  try {
    normalizedOrder = normalizeSignedOrder(parsed.order);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: "Invalid signed order payload.", details: { message: error instanceof Error ? error.message : "Invalid signed order." } },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const builderCode = getServerBuilderCode();
  if (normalizedOrder.builder.toLowerCase() !== builderCode.toLowerCase()) {
    return NextResponse.json({ ok: false, error: "Order builder code mismatch." }, { status: 400 });
  }

  if (parsed.signatureType != null && normalizedOrder.signatureType !== parsed.signatureType) {
    return NextResponse.json({ ok: false, error: "Signature type mismatch." }, { status: 400 });
  }

  let creds: Awaited<ReturnType<typeof getPolymarketServerCreds>>;
  try {
    creds = await getPolymarketServerCreds();
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        code: "AUTH_INVALID_SESSION",
        error: error instanceof Error ? error.message : "Trading session is not initialized.",
      },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (parsed.authAddress && !sameAddress(parsed.authAddress, creds.address)) {
    return NextResponse.json(
      { ok: false, code: "AUTH_INVALID_SESSION", error: "Connected wallet does not match active trading session." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (parsed.funderAddress && creds.tradingWalletAddress && !sameAddress(parsed.funderAddress, creds.tradingWalletAddress)) {
    return NextResponse.json(
      { ok: false, code: "AUTH_INVALID_SESSION", error: "Trading wallet does not match active trading session." },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }
  const execution = parsed.execution ?? parsed.orderType ?? "GTC";
  const orderPayload = {
    order: {
      ...normalizedOrder,
      salt: Number.parseInt(normalizedOrder.salt, 10),
      side: normalizeSide(normalizedOrder.side),
    },
    owner: creds.key,
    orderType: execution,
  };
  const body = JSON.stringify(orderPayload);
  const requestPath = "/order";
  let headers: Record<string, string>;
  try {
    headers = {
      "Content-Type": "application/json",
      ...(await buildL2Headers({ method: "POST", requestPath, body, route: "order" })),
    };
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        code: "AUTH_INVALID_SESSION",
        error: error instanceof Error ? error.message : "Trading session is not initialized.",
      },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  logInfo("api.polymarket.order", "order_submission_started", {
    orderType: execution,
    tokenIdPrefix: normalizedOrder.tokenId.slice(0, 12),
    apiKey: redactCredential(creds.key),
    tradeMode: parsed.tradeMode ?? null,
    signatureType: normalizedOrder.signatureType,
  });

  try {
    const response = await fetch(`${POLYMARKET_CLOB_URL}${requestPath}`, {
      method: "POST",
      headers,
      body,
    });
    const text = await response.text();
    let data: Record<string, unknown> | null = null;
    try {
      data = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    } catch {
      return NextResponse.json(
        { ok: false, error: "CLOB error", details: { status: response.status, snippet: text.trim().slice(0, 120) || null } },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (!response.ok || data?.success === false) {
      logError("api.polymarket.order", { status: response.status, data });
      const serialized = JSON.stringify(data ?? {}).toLowerCase();
      if (response.status === 401 && isInvalidPolymarketAuthError(serialized)) {
        try {
          const session = await getSession();
          clearSession(session);
        } catch {
          // ignore session cleanup failures
        }
        return NextResponse.json(
          { ok: false, code: "AUTH_INVALID_SESSION", error: "Polymarket session expired. Reinitializing trading session.", details: data },
          { status: 401, headers: { "Cache-Control": "no-store" } },
        );
      }
      return NextResponse.json(
        { ok: false, error: data?.errorMsg ?? data?.error ?? "CLOB rejected the order.", details: data },
        { status: response.ok ? 400 : 502 },
      );
    }
    return NextResponse.json({ ok: true, data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logError("api.polymarket.order", error);
    return NextResponse.json({ ok: false, error: "Unable to submit order to Polymarket CLOB." }, { status: 502 });
  }
}
