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
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("gamma-api.polymarket.com/teams"),
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("uses Polymarket MLB team pages when /teams has no exact record", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("gamma-api.polymarket.com/teams")) return new Response(JSON.stringify([]), { status: 200 });
        if (url.includes("polymarket.com/teams/mlb/los-angeles-angels")) {
          return new Response(
            `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify({
              "@context": "https://schema.org",
              "@type": "SportsTeam",
              name: "Los Angeles Angels",
              alternateName: "LAA",
              sport: "MLB",
              logo: "https://polymarket-upload.s3.us-east-2.amazonaws.com/Los Angeles Angels-66dbbd1c0d.png",
            })}</script></head><body></body></html>`,
            { status: 200 },
          );
        }
        if (url.includes("polymarket.com/teams/mlb/detroit-tigers")) {
          return new Response(
            `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify({
              "@context": "https://schema.org",
              "@type": "SportsTeam",
              name: "Detroit Tigers",
              alternateName: "DET",
              sport: "MLB",
              logo: "https://polymarket-upload.s3.us-east-2.amazonaws.com/Detroit Tigers-98db052d82.png",
            })}</script></head><body></body></html>`,
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ teams: [] }), { status: 200 });
      }),
    );

    const { GET } = await import("@/app/api/sports/logos/debug/route");
    const response = await GET(
      new Request(
        "http://localhost/api/sports/logos/debug?category=MLB&sport=Baseball&market=Los%20Angeles%20Angels%20vs.%20Detroit%20Tigers&teams=LAA,DET",
      ),
    );
    const body = await response.json();

    expect(body.finalResults).toMatchObject([
      {
        outcomeName: "LAA",
        matchedPolymarketTeam: { name: "Los Angeles Angels", abbreviation: "LAA", logo: "https://polymarket-upload.s3.us-east-2.amazonaws.com/Los Angeles Angels-66dbbd1c0d.png" },
        finalLogoUrl: "https://polymarket-upload.s3.us-east-2.amazonaws.com/Los Angeles Angels-66dbbd1c0d.png",
        providerReason: "polymarket_team_logo",
      },
      {
        outcomeName: "DET",
        matchedPolymarketTeam: { name: "Detroit Tigers", abbreviation: "DET", logo: "https://polymarket-upload.s3.us-east-2.amazonaws.com/Detroit Tigers-98db052d82.png" },
        finalLogoUrl: "https://polymarket-upload.s3.us-east-2.amazonaws.com/Detroit Tigers-98db052d82.png",
        providerReason: "polymarket_team_logo",
      },
    ]);
    const attempts = body.finalResults[0].polymarketAttempts as Array<{ source?: string }> | undefined;
    expect(attempts?.some((attempt) => attempt.source === "team_page")).toBe(true);
    expect(body.finalResults[0].chosenPolymarketCandidate?.source).toBe("team_page");
    expect(body.finalResults[1].chosenPolymarketCandidate?.source).toBe("team_page");
  });
});
