import { NextResponse } from "next/server";
import { getCachedMarketsApiPayload, type MarketQuerySort, type MarketQueryStatus } from "@/lib/polymarket/markets";
import { logError } from "@/lib/server/logger";

export const runtime = "nodejs";

const sorts = new Set<MarketQuerySort>(["opportunity", "volume", "liquidity", "movement", "spread"]);
const statuses = new Set<MarketQueryStatus>(["live", "upcoming", "all", "stale"]);

function parseIntParam(value: string | null) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
}

function parseVolumeParam(value: string | null) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : undefined;
}

export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const sortParam = searchParams.get("sort");
    const statusParam = searchParams.get("status");
    const status = statusParam && statuses.has(statusParam as MarketQueryStatus) ? (statusParam as MarketQueryStatus) : "all";
    const includeStale = process.env.NODE_ENV !== "production" && status === "stale";
    const payload = await getCachedMarketsApiPayload({
      includeStale,
      limit: parseIntParam(searchParams.get("limit")),
      offset: parseIntParam(searchParams.get("offset")),
      search: searchParams.get("search") ?? undefined,
      minVolume: parseVolumeParam(searchParams.get("minVolume")),
      sort: sortParam && sorts.has(sortParam as MarketQuerySort) ? (sortParam as MarketQuerySort) : "opportunity",
      sport: searchParams.get("sport") ?? undefined,
      status,
    });

    return NextResponse.json(payload, { headers: { "Cache-Control": "s-maxage=60, stale-while-revalidate=60" } });
  } catch (error) {
    logError("api.polymarket.markets", error);
    return NextResponse.json({ error: "Unable to load Polymarket sports markets." }, { status: 502 });
  }
}
