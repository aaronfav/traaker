import { NextResponse } from "next/server";
import { resolveSportsLogosForTeams } from "@/lib/sports/logoResolver";
import { logError } from "@/lib/server/logger";

export const runtime = "nodejs";

function parseTeams(value: string | null) {
  return (value ?? "")
    .split(",")
    .map((team) => team.trim())
    .filter(Boolean)
    .slice(0, 24);
}

export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const category = searchParams.get("category")?.trim() || "Market";
    const teams = parseTeams(searchParams.get("teams"));
    const marketTitle = searchParams.get("marketTitle")?.trim() || "";

    const resolved = await resolveSportsLogosForTeams(category, teams, marketTitle);
    return NextResponse.json({ category, teams: resolved }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logError("api.sports.logos", error);
    return NextResponse.json({ error: "Unable to resolve sports logos." }, { status: 502 });
  }
}
