import { NextResponse } from "next/server";
import { enrichMarket } from "@/lib/sports/enrichmentService";
import type { MarketEnrichmentInput } from "@/lib/sports/enrichmentTypes";
import { logError } from "@/lib/server/logger";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as unknown;
    const market = body && typeof body === "object" && "market" in body ? (body as { market?: MarketEnrichmentInput }).market : (body as MarketEnrichmentInput | null);
    if (!market || typeof market !== "object") {
      return NextResponse.json({ error: "A market payload is required." }, { status: 400 });
    }
    const enriched = await enrichMarket(market as MarketEnrichmentInput);
    return NextResponse.json({ market: enriched }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logError("api.markets.enrich", error);
    return NextResponse.json({ error: "Unable to enrich market right now." }, { status: 502 });
  }
}
