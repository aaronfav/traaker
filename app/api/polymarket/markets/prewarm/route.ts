import { NextResponse } from "next/server";
import { prewarmMarketSnapshot } from "@/lib/polymarket/markets";
import { logError } from "@/lib/server/logger";

export const runtime = "nodejs";

export async function GET() {
  try {
    const started = prewarmMarketSnapshot();
    return NextResponse.json({ started });
  } catch (error) {
    logError("api.polymarket.markets.prewarm", error);
    return NextResponse.json({ error: "Unable to prewarm Polymarket markets." }, { status: 502 });
  }
}
