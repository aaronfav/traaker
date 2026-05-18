import { NextResponse } from "next/server";
import { z } from "zod";
import { POLYMARKET_HOST } from "@/lib/polymarket/client";
import { buildL2Headers } from "@/lib/server/polymarketAuth";
import { logError } from "@/lib/server/logger";
import { isRealTradingEnabled } from "@/lib/server/tradingConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const payloadSchema = z.object({ orderId: z.string().min(1) });

export async function POST(request: Request) {
  if (!isRealTradingEnabled()) {
    return NextResponse.json(
      { ok: false, error: "Real trading is disabled. Set ENABLE_REAL_TRADING=true only after production validation." },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  const parsed = payloadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid cancel request." }, { status: 400 });

  const body = JSON.stringify({ orderID: parsed.data.orderId });
  const requestPath = "/order";
  try {
    const response = await fetch(`${POLYMARKET_HOST}${requestPath}`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        ...buildL2Headers({ method: "DELETE", requestPath, body }),
      },
      body,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) return NextResponse.json({ ok: false, error: "CLOB rejected cancel request.", details: data }, { status: 502 });
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    logError("api.polymarket.order.cancel", error);
    return NextResponse.json({ ok: false, error: "Unable to cancel order." }, { status: 502 });
  }
}
