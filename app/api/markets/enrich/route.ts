import { NextResponse } from "next/server";
import { enrichMarket } from "@/lib/sports/enrichmentService";
import type { MarketEnrichmentInput } from "@/lib/sports/enrichmentTypes";
import { logError, logInfo } from "@/lib/server/logger";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as unknown;
    const market = body && typeof body === "object" && "market" in body ? (body as { market?: MarketEnrichmentInput }).market : (body as MarketEnrichmentInput | null);
    if (!market || typeof market !== "object") {
      return NextResponse.json({ error: "A market payload is required." }, { status: 400 });
    }
    logInfo("api.markets.enrich.request", "incoming enrichment payload", {
      marketId: market.id ?? market.marketId ?? null,
      title: market.title ?? null,
      question: market.question ?? null,
      sport: market.sport ?? null,
      league: market.league ?? market.category ?? null,
      startTime: market.startTime ?? null,
      endTime: market.endTime ?? null,
      outcomes: Array.isArray(market.outcomes)
        ? market.outcomes.map((outcome) => (typeof outcome === "object" && outcome ? { name: outcome.name ?? "", price: outcome.price ?? null } : null)).filter(Boolean)
        : market.outcomes && typeof market.outcomes === "object" && !Array.isArray(market.outcomes)
          ? Object.entries(market.outcomes).map(([name, price]) => ({ name, price: typeof price === "string" || typeof price === "number" ? Number(price) : null }))
          : [],
    });
    const enriched = await enrichMarket(market as MarketEnrichmentInput);
    return NextResponse.json({ market: enriched }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logError("api.markets.enrich", error);
    return NextResponse.json({ error: "Unable to enrich market right now." }, { status: 502 });
  }
}
