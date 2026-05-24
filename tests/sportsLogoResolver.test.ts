import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeTeamName, resetSportsLogoCache, resolveSportsLogo } from "@/lib/sports/logoResolver";

describe("sports logo resolver", () => {
  afterEach(() => {
    resetSportsLogoCache();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("normalizes common team aliases", () => {
    expect(normalizeTeamName("Cavaliers", "Knicks vs Cavaliers", "NBA")).toBe("Cleveland Cavaliers");
    expect(normalizeTeamName("Knicks", "Knicks vs Cavaliers", "NBA")).toBe("New York Knicks");
    expect(normalizeTeamName("Brighton & Hove Albion FC", "Premier League winner", "Soccer")).toBe("Brighton and Hove Albion");
    expect(normalizeTeamName("Manchester United FC", "Premier League winner", "Soccer")).toBe("Manchester United");
    expect(normalizeTeamName("Tottenham Hotspur FC", "Premier League winner", "Soccer")).toBe("Tottenham Hotspur");
    expect(normalizeTeamName("Juventus FC", "Serie A winner", "Soccer")).toBe("Juventus");
  });

  it("falls back cleanly for non-team sports", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveSportsLogo({
      category: "UFC",
      marketTitle: "UFC 315 main event",
      outcomeName: "Fighter A",
    });

    expect(result).toEqual({ logoUrl: null, teamName: "Fighter A", source: "fallback" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses TheSportsDB team badge when available", async () => {
    vi.stubEnv("THESPORTSDB_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            teams: [{ strTeam: "Cleveland Cavaliers", strTeamBadge: "https://r2.thesportsdb.com/images/media/team/badge/cavaliers.png" }],
          }),
          { status: 200 },
        ),
      ),
    );

    const result = await resolveSportsLogo({
      category: "NBA",
      marketTitle: "Knicks vs Cavaliers",
      outcomeName: "Cavaliers",
    });

    expect(result).toEqual({
      logoUrl: "https://r2.thesportsdb.com/images/media/team/badge/cavaliers.png",
      teamName: "Cleveland Cavaliers",
      source: "thesportsdb",
    });
  });

  it("prefers league-specific Soccer matching before generic fallback", async () => {
    vi.stubEnv("THESPORTSDB_API_KEY", "test-key");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("search_all_teams.php")) {
        return new Response(
          JSON.stringify({
            teams: [
              {
                strTeam: "Brighton and Hove Albion",
                strTeamAlternate: "Brighton & Hove Albion Football Club, Brighton, BHAFC",
                strBadge: "https://r2.thesportsdb.com/images/media/team/badge/brighton.png",
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ teams: [{ strTeam: "Arsenal", strBadge: "https://r2.thesportsdb.com/arsenal.png" }] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveSportsLogo({
      category: "EPL",
      sport: "Soccer",
      marketTitle: "English Premier League winner",
      outcomeName: "Brighton & Hove Albion FC",
    });

    expect(result).toEqual({
      logoUrl: "https://r2.thesportsdb.com/images/media/team/badge/brighton.png",
      teamName: "Brighton and Hove Albion",
      source: "thesportsdb",
    });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("search_all_teams.php"), { cache: "no-store" });
  });
});
