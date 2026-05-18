import { NextResponse } from "next/server";
import { POLYMARKET_HOST } from "@/lib/polymarket/client";
import { buildL2Headers } from "@/lib/server/polymarketAuth";
import { logError } from "@/lib/server/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function signedGet(path: string) {
  const response = await fetch(`${POLYMARKET_HOST}${path}`, {
    method: "GET",
    headers: buildL2Headers({ method: "GET", requestPath: path }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error ?? `CLOB request failed (${response.status})`);
  return data;
}

export async function GET() {
  try {
    const [balance, openOrders, trades] = await Promise.all([
      signedGet("/balance-allowance?asset_type=COLLATERAL"),
      signedGet("/data/orders"),
      signedGet("/data/trades"),
    ]);
    return NextResponse.json({ ok: true, balance, openOrders, trades }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logError("api.polymarket.account", error);
    return NextResponse.json({ ok: false, error: "Unable to load Polymarket account data." }, { status: 502 });
  }
}
