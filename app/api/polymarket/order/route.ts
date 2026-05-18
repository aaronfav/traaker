import { NextResponse } from "next/server";
import { z } from "zod";
import { POLYMARKET_HOST } from "@/lib/polymarket/client";
import { buildL2Headers, getPolymarketServerCreds, getServerBuilderCode, redactCredential } from "@/lib/server/polymarketAuth";
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
  orderType: orderTypeSchema,
});

const normalizeSide = (value: string | number) => {
  if (typeof value === "number") return String(value);
  const normalized = value.trim().toLowerCase();
  if (normalized === "buy") return "BUY";
  if (normalized === "sell") return "SELL";
  return value;
};

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

  const builderCode = getServerBuilderCode();
  if (parsed.order.builder.toLowerCase() !== builderCode.toLowerCase()) {
    return NextResponse.json({ ok: false, error: "Order builder code mismatch." }, { status: 400 });
  }

  const tokenId = parsed.order.tokenId ?? parsed.order.tokenID;
  if (tokenId == null) {
    return NextResponse.json({ ok: false, error: "Signed order is missing tokenId." }, { status: 400 });
  }

  const salt = Number.parseInt(String(parsed.order.salt), 10);
  if (!Number.isFinite(salt)) {
    return NextResponse.json({ ok: false, error: "Signed order salt is invalid." }, { status: 400 });
  }

  const creds = getPolymarketServerCreds();
  const orderPayload = {
    order: {
      salt,
      maker: parsed.order.maker,
      signer: parsed.order.signer,
      taker: parsed.order.taker ?? "0x0000000000000000000000000000000000000000",
      tokenId: String(tokenId),
      makerAmount: String(parsed.order.makerAmount),
      takerAmount: String(parsed.order.takerAmount),
      side: normalizeSide(parsed.order.side),
      signatureType: Number(parsed.order.signatureType),
      timestamp: String(parsed.order.timestamp),
      expiration: String(parsed.order.expiration),
      metadata: parsed.order.metadata,
      builder: parsed.order.builder,
      signature: parsed.order.signature,
    },
    owner: creds.key,
    orderType: parsed.orderType,
  };
  const body = JSON.stringify(orderPayload);
  const requestPath = "/order";
  const headers = {
    "Content-Type": "application/json",
    ...buildL2Headers({ method: "POST", requestPath, body }),
  };

  logInfo("api.polymarket.order", "order_submission_started", {
    orderType: parsed.orderType,
    tokenIdPrefix: String(tokenId).slice(0, 12),
    builderCode,
    apiKey: redactCredential(creds.key),
  });

  try {
    const response = await fetch(`${POLYMARKET_HOST}${requestPath}`, {
      method: "POST",
      headers,
      body,
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok || data?.success === false) {
      logError("api.polymarket.order", { status: response.status, data });
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
