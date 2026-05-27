import { afterEach, describe, expect, it, vi } from "vitest";
import { resetSportsLogoCache } from "@/lib/sports/logoResolver";
import { resetPolymarketTeamsCache } from "@/lib/polymarket/teams";

describe("/api/sports/logos/debug", () => {
  afterEach(() => {
    resetSportsLogoCache();
    resetPolymarketTeamsCache();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns sanitized provider attempts without API secrets", async () => {
    vi.stubEnv("SPORTSMONKS_API_KEY", "sportsmonks-secret");
    vi.stubEnv("THESPORTSDB_API_KEY", "sportsdb-secret");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("gamma-api.polymarket.com/teams")) {
          return new Response(
            JSON.stringify([
              { id: 7001, name: "Paris Saint-Germain", alias: "PSG", abbreviation: "PSG", logo: "https://polymarket-upload.s3.us-east-2.amazonaws.com/psg.png" },
              { id: 7002, name: "Arsenal", alias: "Arsenal FC", abbreviation: "ARS", logo: "https://polymarket-upload.s3.us-east-2.amazonaws.com/arsenal.png" },
            ]),
            { status: 200 },
          );
        }
        if (url.includes("api.sportmonks.com")) return new Response(JSON.stringify({ data: [] }), { status: 200 });
        return new Response(
          JSON.stringify({
            teams: [{ strTeam: "Arsenal", strTeamBadge: "https://r2.thesportsdb.com/images/media/team/badge/arsenal.png" }],
          }),
          { status: 200 },
        );
      }),
    );

    const { GET } = await import("@/app/api/sports/logos/debug/route");
    const response = await GET(
      new Request(
        "http://localhost/api/sports/logos/debug?category=Soccer&market=Paris%20Saint-Germain%20FC%20vs.%20Arsenal%20FC&teams=ARS",
      ),
    );
    const body = await response.json();

    expect(body.extractedTeams).toEqual(["Paris Saint-Germain", "Arsenal"]);
    expect(body.mappedOutcomes).toEqual({ ARS: "Arsenal" });
    expect(body.finalResults[0].matchedPolymarketTeam).toMatchObject({
      id: 7002,
      abbreviation: "ARS",
      name: "Arsenal",
      logo: "https://polymarket-upload.s3.us-east-2.amazonaws.com/arsenal.png",
      matchedBy: "name",
    });
    expect(body.sportsMonksQueries).toHaveLength(0);
    expect(body.theSportsDbQueries).toHaveLength(0);
    expect(body.finalResults[0]).toMatchObject({
      outcomeName: "ARS",
      canonicalTeam: "Arsenal",
      cleanedTeamCandidate: "ars",
      matchedPolymarketTeam: {
        id: 7002,
        providerId: null,
        name: "Arsenal",
        abbreviation: "ARS",
        alias: "Arsenal FC",
        logo: "https://polymarket-upload.s3.us-east-2.amazonaws.com/arsenal.png",
        matchedBy: "name",
      },
      genericLogoChosen: false,
      finalLogoUrl: "https://polymarket-upload.s3.us-east-2.amazonaws.com/arsenal.png",
      providerReason: "polymarket_team_logo",
      logoUrl: "https://polymarket-upload.s3.us-east-2.amazonaws.com/arsenal.png",
      source: "polymarket",
      entityType: "club_team",
      normalizedInput: "Arsenal",
      providerUsed: "polymarket",
    });
    expect(JSON.stringify(body)).not.toContain("sportsmonks-secret");
    expect(JSON.stringify(body)).not.toContain("sportsdb-secret");
  });

  it("classifies World Cup winner outcomes as national teams", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("gamma-api.polymarket.com/teams")) return new Response(JSON.stringify([]), { status: 200 });
      return new Response(JSON.stringify({ teams: [] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { GET } = await import("@/app/api/sports/logos/debug/route");
    const response = await GET(
      new Request("http://localhost/api/sports/logos/debug?category=Soccer&market=2026%20FIFA%20World%20Cup%20Winner&teams=France,USA,England"),
    );
    const body = await response.json();

    expect(body.finalResults).toMatchObject([
      { outcomeName: "France", logoUrl: "https://flagcdn.com/fr.svg", entityType: "national_team", providerUsed: "local" },
      { outcomeName: "USA", teamName: "United States", logoUrl: "https://flagcdn.com/us.svg", entityType: "national_team", providerUsed: "local" },
      { outcomeName: "England", logoUrl: "https://flagcdn.com/gb-eng.svg", entityType: "national_team", providerUsed: "local" },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("gamma-api.polymarket.com/teams"), { cache: "no-store" });
  });
});
