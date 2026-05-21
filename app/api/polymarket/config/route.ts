import { NextResponse } from "next/server";
import { getServerBuilderCode } from "@/lib/server/polymarketAuth";
import { isRealTradingEnabled } from "@/lib/server/tradingConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(
      { ok: true, realTradingEnabled: isRealTradingEnabled(), builderCode: getServerBuilderCode() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Invalid Polymarket config." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
