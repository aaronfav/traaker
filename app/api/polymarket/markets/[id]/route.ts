import { NextResponse } from "next/server";
import { fetchSportsMarkets } from "@/lib/polymarket/markets";
import { logError } from "@/lib/server/logger";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const market = (await fetchSportsMarkets()).find((item) => item.id === id || item.slug === id || item.conditionId === id);
    if (!market) {
      return NextResponse.json({ error: "Market not found." }, { status: 404 });
    }

    return NextResponse.json({ market }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logError("api.polymarket.markets.id", error);
    return NextResponse.json({ error: "Unable to load market." }, { status: 502 });
  }
}
