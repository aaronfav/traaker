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
        { query: "Knicks", logoUrl: "https://r2.thesportsdb.com/knicks.png", teamName: "New York Knicks", source: "thesportsdb", confidence: "alias_match" },
        { query: "Cavaliers", logoUrl: "https://r2.thesportsdb.com/cavaliers.png", teamName: "Cleveland Cavaliers", source: "thesportsdb", confidence: "alias_match" },
      ],
    });
  });
});
