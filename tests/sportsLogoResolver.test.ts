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
});
