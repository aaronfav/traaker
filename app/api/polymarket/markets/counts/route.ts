import { NextResponse } from "next/server";
import { getMarketCountsApiResponse } from "@/lib/polymarket/markets";
import { logError } from "@/lib/server/logger";

export const runtime = "nodejs";

function parseVolumeParam(value: string | null) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : undefined;
}

export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const minVolume = parseVolumeParam(searchParams.get("minVolume"));
    return NextResponse.json(getMarketCountsApiResponse(minVolume), {
      headers: { "Cache-Control": "s-maxage=60, stale-while-revalidate=60" },
    });
  } catch (error) {
    logError("api.polymarket.markets.counts", error);
    return NextResponse.json({ error: "Unable to load Polymarket market counts." }, { status: 502 });
  }
}
