import { NextResponse } from "next/server";
import { getMarketCountsApiResponse } from "@/lib/polymarket/markets";
import { logError } from "@/lib/server/logger";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(getMarketCountsApiResponse(), {
      headers: { "Cache-Control": "s-maxage=60, stale-while-revalidate=60" },
    });
  } catch (error) {
    logError("api.polymarket.markets.counts", error);
    return NextResponse.json({ error: "Unable to load Polymarket market counts." }, { status: 502 });
  }
}
