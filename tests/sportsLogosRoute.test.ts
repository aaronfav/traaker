import { afterEach, describe, expect, it, vi } from "vitest";
import { resetSportsLogoCache } from "@/lib/sports/logoResolver";

describe("/api/sports/logos", () => {
  afterEach(() => {
    resetSportsLogoCache();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("resolves requested team logos", async () => {
    vi.stubEnv("THESPORTSDB_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const isCavaliers = url.includes("Cleveland%20Cavaliers");
        return new Response(
          JSON.stringify({
            teams: [
              {
                strTeam: isCavaliers ? "Cleveland Cavaliers" : "New York Knicks",
                strTeamBadge: isCavaliers ? "https://r2.thesportsdb.com/cavaliers.png" : "https://r2.thesportsdb.com/knicks.png",
              },
            ],
          }),
          { status: 200 },
        );
      }),
    );

    const { GET } = await import("@/app/api/sports/logos/route");
    const response = await GET(new Request("http://localhost/api/sports/logos?category=NBA&teams=Knicks,Cavaliers"));
    const body = await response.json();

    expect(body).toEqual({
      category: "NBA",
      teams: [
        {
          query: "Knicks",
          logoUrl: "https://r2.thesportsdb.com/knicks.png",
          teamName: "New York Knicks",
          teamDisplayName: "New York Knicks",
          source: "thesportsdb",
          logoSource: "thesportsdb",
          confidence: "alias_match",
        },
        {
          query: "Cavaliers",
          logoUrl: "https://r2.thesportsdb.com/cavaliers.png",
          teamName: "Cleveland Cavaliers",
          teamDisplayName: "Cleveland Cavaliers",
          source: "thesportsdb",
          logoSource: "thesportsdb",
          confidence: "alias_match",
        },
      ],
    });
  });

  it("uses SportsMonks before TheSportsDB for soccer logos", async () => {
    vi.stubEnv("SPORTSMONKS_API_KEY", "sportsmonks-key");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("api.sportmonks.com")) {
        return new Response(
          JSON.stringify({
            data: [{ id: 19, name: "Crystal Palace", image_path: "https://cdn.sportmonks.com/images/soccer/teams/19/19.png" }],
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ teams: [{ strTeam: "Liverpool", strBadge: "https://r2.thesportsdb.com/liverpool.png" }] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { GET } = await import("@/app/api/sports/logos/route");
    const response = await GET(new Request("http://localhost/api/sports/logos?category=Soccer&teams=Crystal%20Palace%20FC"));
    const body = await response.json();

    expect(body).toEqual({
      category: "Soccer",
      teams: [
        {
          query: "Crystal Palace FC",
          logoUrl: "https://cdn.sportmonks.com/images/soccer/teams/19/19.png",
          teamName: "Crystal Palace",
          teamDisplayName: "Crystal Palace",
          source: "sportsmonks",
          logoSource: "sportsmonks",
          confidence: "exact_normalized_match",
        },
      ],
    });
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("thesportsdb.com"), { cache: "no-store" });
  });
});
