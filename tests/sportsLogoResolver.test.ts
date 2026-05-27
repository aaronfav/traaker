import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeTeamName, resetSportsLogoCache, resolveSportsLogo } from "@/lib/sports/logoResolver";
import { enrichMarketOutcomeLogos } from "@/lib/polymarket/markets";
import { resetPolymarketTeamsCache, resolvePolymarketTeamLogo } from "@/lib/polymarket/teams";
import type { TerminalMarket } from "@/lib/polymarket/types";

describe("sports logo resolver", () => {
  afterEach(() => {
    resetSportsLogoCache();
    resetPolymarketTeamsCache();
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

    expect(result).toMatchObject({
      logoUrl: null,
      teamName: "Fighter A",
      teamDisplayName: "Fighter A",
      source: "fallback",
      logoSource: "fallback",
      confidence: "fallback",
    });
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

    expect(result).toMatchObject({
      logoUrl: "https://r2.thesportsdb.com/images/media/team/badge/cavaliers.png",
      teamName: "Cleveland Cavaliers",
      teamDisplayName: "Cleveland Cavaliers",
      source: "thesportsdb",
      logoSource: "thesportsdb",
      confidence: "provider_exact_name",
      acceptedReason: "provider_exact_name",
    });
    expect(result.rejectionReason).toBeUndefined();
  });

  it("uses SportsMonks soccer logos on exact normalized matches", async () => {
    vi.stubEnv("SPORTSMONKS_API_KEY", "sportsmonks-key");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("api.sportmonks.com")) {
        return new Response(
          JSON.stringify({
            data: [{ id: 8, name: "Liverpool", image_path: "https://cdn.sportmonks.com/images/soccer/teams/8/8.png" }],
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ teams: [] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolveSportsLogo({ category: "EPL", sport: "Soccer", marketTitle: "Premier League winner", outcomeName: "Liverpool FC" })).resolves.toMatchObject({
      logoUrl: "https://cdn.sportmonks.com/images/soccer/teams/8/8.png",
      teamName: "Liverpool",
      teamDisplayName: "Liverpool",
      source: "sportsmonks",
      logoSource: "sportsmonks",
      confidence: "provider_exact_name",
      acceptedReason: "provider_exact_name",
    });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("api.sportmonks.com/v3/football/teams/search/Liverpool"), { cache: "no-store" });
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("thesportsdb.com"), { cache: "no-store" });
  });

  it("uses Polymarket team logos before remote providers when available", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      resolveSportsLogo({
        category: "Soccer",
        sport: "Soccer",
        marketTitle: "Champions League Winner",
        outcomeName: "Arsenal",
        polymarketLogoUrl: "https://polymarket-upload.s3.us-east-2.amazonaws.com/arsenal.png",
      }),
    ).resolves.toMatchObject({
      logoUrl: "https://polymarket-upload.s3.us-east-2.amazonaws.com/arsenal.png",
      teamName: "Arsenal",
      source: "polymarket",
      logoSource: "polymarket",
      entityType: "club_team",
      acceptedReason: "polymarket_team_logo",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses SportsMonks team id lookups when an id is available", async () => {
    vi.stubEnv("SPORTSMONKS_API_KEY", "sportsmonks-key");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      void input;
      return new Response(
        JSON.stringify({
          data: { id: 19, name: "Arsenal", short_code: "ARS", image_path: "https://cdn.sportmonks.com/images/soccer/teams/19/19.png" },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolveSportsLogo({ category: "Soccer", sport: "Soccer", marketTitle: "Champions League Winner", outcomeName: "Arsenal", sportsMonksTeamId: 19 })).resolves.toMatchObject({
      logoUrl: "https://cdn.sportmonks.com/images/soccer/teams/19/19.png",
      source: "sportsmonks",
      confidence: "league_team_match",
      acceptedReason: "provider_team_id",
    });
    expect(String(fetchMock.mock.calls[0]?.[0] ?? "")).toContain("/v3/football/teams/19");
  });

  it("resolves PSG from SportsMonks image_path using explicit aliases", async () => {
    vi.stubEnv("SPORTSMONKS_API_KEY", "sportsmonks-key");
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [{ id: 591, name: "PSG", short_code: "PSG", image_path: "https://cdn.sportmonks.com/images/soccer/teams/15/591.png" }],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolveSportsLogo({ category: "Soccer", sport: "Soccer", marketTitle: "Paris Saint-Germain FC vs. Arsenal FC", outcomeName: "Paris Saint-Germain" })).resolves.toMatchObject({
      logoUrl: "https://cdn.sportmonks.com/images/soccer/teams/15/591.png",
      teamName: "PSG",
      teamDisplayName: "PSG",
      source: "sportsmonks",
      logoSource: "sportsmonks",
      confidence: "provider_alias_name",
      acceptedReason: "provider_alias_name",
    });
  });

  it("maps ARS and Arsenal FC to Arsenal before provider lookup", async () => {
    vi.stubEnv("SPORTSMONKS_API_KEY", "sportsmonks-key");
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [{ id: 19, name: "Arsenal", short_code: "ARS", image_path: "https://cdn.sportmonks.com/images/soccer/teams/19/19.png" }],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolveSportsLogo({ category: "Soccer", sport: "Soccer", marketTitle: "Paris Saint-Germain FC vs. Arsenal FC", outcomeName: "ARS" })).resolves.toMatchObject({
      logoUrl: "https://cdn.sportmonks.com/images/soccer/teams/19/19.png",
      teamName: "Arsenal",
      confidence: "provider_exact_name",
    });

    resetSportsLogoCache();
    await expect(resolveSportsLogo({ category: "Soccer", sport: "Soccer", marketTitle: "Paris Saint-Germain FC vs. Arsenal FC", outcomeName: "Arsenal FC" })).resolves.toMatchObject({
      logoUrl: "https://cdn.sportmonks.com/images/soccer/teams/19/19.png",
      teamName: "Arsenal",
      confidence: "provider_exact_name",
    });
  });

  it("sends SportsMonks a clean team query instead of the full market title", async () => {
    vi.stubEnv("SPORTSMONKS_API_KEY", "sportsmonks-key");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      void input;
      return new Response(
        JSON.stringify({
          data: [{ id: 8, name: "Liverpool", image_path: "https://cdn.sportmonks.com/images/soccer/teams/8/8.png" }],
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await resolveSportsLogo({
      category: "EPL",
      sport: "Soccer",
      marketTitle: "Liverpool FC vs. Brentford FC - More Markets",
      outcomeName: "Liverpool",
    });

    const sportsMonksUrl = String(fetchMock.mock.calls[0]?.[0] ?? "");
    expect(sportsMonksUrl).toContain("/teams/search/Liverpool");
    expect(sportsMonksUrl).not.toContain("Liverpool%20FC%20vs");
  });

  it("uses SportsMonks soccer logos on explicit alias matches", async () => {
    vi.stubEnv("SPORTSMONKS_API_KEY", "sportsmonks-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: [{ id: 6, name: "Tottenham Hotspur", image_path: "https://cdn.sportmonks.com/images/soccer/teams/6/6.png" }],
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(resolveSportsLogo({ category: "EPL", sport: "Soccer", marketTitle: "Premier League winner", outcomeName: "Tottenham" })).resolves.toMatchObject({
      logoUrl: "https://cdn.sportmonks.com/images/soccer/teams/6/6.png",
      teamName: "Tottenham Hotspur",
      teamDisplayName: "Tottenham Hotspur",
      source: "sportsmonks",
      logoSource: "sportsmonks",
      confidence: "provider_exact_name",
    });
  });

  it("falls back to TheSportsDB when SportsMonks misses", async () => {
    vi.stubEnv("SPORTSMONKS_API_KEY", "sportsmonks-key");
    vi.stubEnv("THESPORTSDB_API_KEY", "sportsdb-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("api.sportmonks.com")) return new Response(JSON.stringify({ data: [] }), { status: 200 });
        return new Response(
          JSON.stringify({
            teams: [{ strTeam: "Arsenal", strTeamAlternate: "Arsenal FC", strBadge: "https://r2.thesportsdb.com/arsenal.png" }],
          }),
          { status: 200 },
        );
      }),
    );

    await expect(resolveSportsLogo({ category: "EPL", sport: "Soccer", marketTitle: "Premier League winner", outcomeName: "Arsenal FC" })).resolves.toMatchObject({
      logoUrl: "https://r2.thesportsdb.com/arsenal.png",
      teamName: "Arsenal",
      teamDisplayName: "Arsenal",
      source: "thesportsdb",
      logoSource: "thesportsdb",
      confidence: "provider_exact_name",
    });
  });

  it("uses TheSportsDB strTeamBadge as a fallback logo", async () => {
    vi.stubEnv("SPORTSMONKS_API_KEY", "sportsmonks-key");
    vi.stubEnv("THESPORTSDB_API_KEY", "sportsdb-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("api.sportmonks.com")) return new Response(JSON.stringify({ data: [] }), { status: 200 });
        return new Response(
          JSON.stringify({
            teams: [{ strTeam: "Paris Saint-Germain", strTeamBadge: "https://r2.thesportsdb.com/images/media/team/badge/psg.png" }],
          }),
          { status: 200 },
        );
      }),
    );

    await expect(resolveSportsLogo({ category: "Soccer", sport: "Soccer", marketTitle: "Paris Saint-Germain FC vs. Arsenal FC", outcomeName: "PSG" })).resolves.toMatchObject({
      logoUrl: "https://r2.thesportsdb.com/images/media/team/badge/psg.png",
      teamName: "Paris Saint-Germain",
      teamDisplayName: "Paris Saint-Germain",
      source: "thesportsdb",
      logoSource: "thesportsdb",
      confidence: "provider_exact_name",
    });
  });

  it("sends TheSportsDB a clean team query instead of the full market title", async () => {
    vi.stubEnv("THESPORTSDB_API_KEY", "sportsdb-key");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      void input;
      return new Response(
        JSON.stringify({
          teams: [{ strTeam: "Arsenal", strTeamBadge: "https://r2.thesportsdb.com/arsenal.png" }],
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await resolveSportsLogo({
      category: "EPL",
      sport: "Soccer",
      marketTitle: "Crystal Palace FC vs. Arsenal FC",
      outcomeName: "Arsenal",
    });

    const sportsDbUrl = String(fetchMock.mock.calls[0]?.[0] ?? "");
    expect(sportsDbUrl).toContain("searchteams.php?t=Arsenal");
    expect(sportsDbUrl).not.toContain("Crystal%20Palace%20FC%20vs");
  });

  it("does not query providers for totals or Yes/No outcomes", async () => {
    vi.stubEnv("SPORTSMONKS_API_KEY", "sportsmonks-key");
    vi.stubEnv("THESPORTSDB_API_KEY", "sportsdb-key");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolveSportsLogo({ category: "Soccer", sport: "Soccer", marketTitle: "Liverpool FC vs. Brentford FC - More Markets", outcomeName: "O/U 4.5" })).resolves.toMatchObject({
      logoUrl: null,
      source: "fallback",
      confidence: "fallback",
      entityType: "non_team",
    });
    await expect(resolveSportsLogo({ category: "Soccer", sport: "Soccer", marketTitle: "PSG vs Arsenal - More Markets", outcomeName: "O/U 0.5" })).resolves.toMatchObject({
      logoUrl: null,
      source: "fallback",
      confidence: "fallback",
      entityType: "non_team",
    });
    await expect(resolveSportsLogo({ category: "Soccer", sport: "Soccer", marketTitle: "Will Arsenal win?", outcomeName: "Yes" })).resolves.toMatchObject({
      logoUrl: null,
      source: "fallback",
      confidence: "fallback",
      entityType: "non_team",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves a team-specific outcome label with a trailing betting line", async () => {
    vi.stubEnv("SPORTSMONKS_API_KEY", "sportsmonks-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: [{ id: 88, name: "Rayo Vallecano de Madrid", short_code: "RVM", image_path: "https://cdn.sportmonks.com/images/soccer/teams/88/88.png" }],
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(
      resolveSportsLogo({
        category: "Soccer",
        sport: "Soccer",
        marketTitle: "Crystal Palace FC vs. Rayo Vallecano De Madrid",
        outcomeName: "Rayo Vallecano De Madrid 1 5",
      }),
    ).resolves.toMatchObject({
      logoUrl: "https://cdn.sportmonks.com/images/soccer/teams/88/88.png",
      teamName: "Rayo Vallecano de Madrid",
      teamDisplayName: "Rayo Vallecano de Madrid",
      source: "sportsmonks",
      logoSource: "sportsmonks",
      confidence: "provider_exact_name",
    });
  });

  it("resolves France in World Cup winner markets to a national team flag", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolveSportsLogo({ category: "Soccer", sport: "Soccer", marketTitle: "2026 FIFA World Cup Winner", outcomeName: "France" })).resolves.toMatchObject({
      logoUrl: "https://flagcdn.com/fr.svg",
      teamName: "France",
      entityType: "national_team",
      source: "local",
      providerUsed: "local",
      acceptedReason: "country_flag",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves USA to United States flag in World Cup winner markets", async () => {
    await expect(resolveSportsLogo({ category: "Soccer", sport: "Soccer", marketTitle: "World Cup Winner", outcomeName: "USA" })).resolves.toMatchObject({
      logoUrl: "https://flagcdn.com/us.svg",
      teamName: "United States",
      normalizedInput: "United States",
      entityType: "national_team",
    });
  });

  it("resolves England to the England flag rather than the United Kingdom flag", async () => {
    await expect(resolveSportsLogo({ category: "Soccer", sport: "Soccer", marketTitle: "World Cup Winner", outcomeName: "England" })).resolves.toMatchObject({
      logoUrl: "https://flagcdn.com/gb-eng.svg",
      teamName: "England",
      entityType: "national_team",
    });
  });

  it("keeps Champions League winner outcomes as club teams", async () => {
    vi.stubEnv("SPORTSMONKS_API_KEY", "sportsmonks-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: [{ id: 19, name: "Arsenal", short_code: "ARS", image_path: "https://cdn.sportmonks.com/images/soccer/teams/19/19.png" }],
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(resolveSportsLogo({ category: "Soccer", sport: "Soccer", marketTitle: "Champions League Winner", outcomeName: "Arsenal" })).resolves.toMatchObject({
      entityType: "club_team",
      logoUrl: "https://cdn.sportmonks.com/images/soccer/teams/19/19.png",
    });
  });

  it("accepts known provider short codes without loose fuzzy matching", async () => {
    vi.stubEnv("SPORTSMONKS_API_KEY", "sportsmonks-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: [{ id: 19, name: "Gunners", short_code: "ARS", image_path: "https://cdn.sportmonks.com/images/soccer/teams/19/19.png" }],
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(resolveSportsLogo({ category: "Soccer", sport: "Soccer", marketTitle: "Champions League Winner", outcomeName: "Arsenal" })).resolves.toMatchObject({
      logoUrl: "https://cdn.sportmonks.com/images/soccer/teams/19/19.png",
      confidence: "provider_shortcode",
      acceptedReason: "provider_shortcode",
    });
  });

  it("enriches NBA Champion outcomes with outcomeLogoUrl for old working cases", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("gamma-api.polymarket.com/teams")) {
          return new Response(
            JSON.stringify([
              { id: 9001, name: "San Antonio Spurs", alias: "Spurs", abbreviation: "SAS", logo: "https://polymarket-upload.s3.us-east-2.amazonaws.com/spurs.png" },
              { id: 9002, name: "New York Knicks", alias: "Knicks", abbreviation: "NYK", logo: "https://polymarket-upload.s3.us-east-2.amazonaws.com/knicks.png" },
              { id: 9003, name: "Oklahoma City Thunder", alias: "Thunder", abbreviation: "OKC", logo: "https://polymarket-upload.s3.us-east-2.amazonaws.com/thunder.png" },
            ]),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({ teams: [] }),
          { status: 200 },
        );
      }),
    );

    const [market] = await enrichMarketOutcomeLogos([
      {
        id: "nba-champion",
        conditionId: "condition",
        slug: "nba-champion",
        title: "2026 NBA Champion",
        sport: "Basketball",
        league: "NBA",
        status: "upcoming",
        startTime: "2026-10-01T00:00:00.000Z",
        endTime: null,
        yesPrice: 0.4,
        noPrice: 0.6,
        volume24h: 10000,
        volume: 10000,
        liquidity: 5000,
        priceMove24h: 0,
        volume1wk: 10000,
        volumeAcceleration: 0,
        spread: 0.02,
        recentTradesCount: 0,
        opportunityScore: 1,
        outcomes: { yes: "Spurs", no: "Knicks" },
        tokenIds: { yes: "yes", no: "no" },
        outcomeOptions: [
          { name: "Spurs", price: 0.33, tokenId: "spurs" },
          { name: "Knicks", price: 0.25, tokenId: "knicks" },
          { name: "Thunder", price: 0.2, tokenId: "thunder" },
        ],
        source: "polymarket",
      } satisfies TerminalMarket,
    ]);

    expect(market.outcomeOptions).toMatchObject([
      { name: "Spurs", teamDisplayName: "San Antonio Spurs", polymarketTeamLogoUrl: "https://polymarket-upload.s3.us-east-2.amazonaws.com/spurs.png", outcomeLogoUrl: "https://polymarket-upload.s3.us-east-2.amazonaws.com/spurs.png", entityType: "club_team" },
      { name: "Knicks", teamDisplayName: "New York Knicks", polymarketTeamLogoUrl: "https://polymarket-upload.s3.us-east-2.amazonaws.com/knicks.png", outcomeLogoUrl: "https://polymarket-upload.s3.us-east-2.amazonaws.com/knicks.png", entityType: "club_team" },
      { name: "Thunder", teamDisplayName: "Oklahoma City Thunder", polymarketTeamLogoUrl: "https://polymarket-upload.s3.us-east-2.amazonaws.com/thunder.png", outcomeLogoUrl: "https://polymarket-upload.s3.us-east-2.amazonaws.com/thunder.png", entityType: "club_team" },
    ]);
  });

  it("preserves Polymarket team logos for MLB team outcomes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("gamma-api.polymarket.com/teams")) {
          return new Response(
            JSON.stringify([
              { id: 7001, name: "Los Angeles Angels", alias: "Angels", abbreviation: "LAA", logo: "https://polymarket-upload.s3.us-east-2.amazonaws.com/angels.png" },
              { id: 7002, name: "Detroit Tigers", alias: "Tigers", abbreviation: "DET", logo: "https://polymarket-upload.s3.us-east-2.amazonaws.com/tigers.png" },
            ]),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }),
    );

    const [market] = await enrichMarketOutcomeLogos([
      {
        id: "mlb-matchup",
        conditionId: "condition",
        slug: "mlb-matchup",
        title: "Los Angeles Angels vs. Detroit Tigers",
        sport: "Baseball",
        league: "MLB",
        status: "upcoming",
        startTime: "2026-06-01T00:00:00.000Z",
        endTime: null,
        yesPrice: 0.52,
        noPrice: 0.48,
        volume24h: 10000,
        volume: 10000,
        liquidity: 5000,
        priceMove24h: 0,
        volume1wk: 10000,
        volumeAcceleration: 0,
        spread: 0.02,
        recentTradesCount: 0,
        opportunityScore: 1,
        outcomes: { yes: "Los Angeles Angels", no: "Detroit Tigers" },
        tokenIds: { yes: "angels", no: "tigers" },
        outcomeOptions: [
          { name: "Los Angeles Angels", price: 0.52, tokenId: "angels" },
          { name: "Detroit Tigers", price: 0.48, tokenId: "tigers" },
        ],
        source: "polymarket",
      } satisfies TerminalMarket,
    ]);

    expect(market.outcomeOptions).toMatchObject([
      {
        name: "Los Angeles Angels",
        polymarketTeamLogoUrl: "https://polymarket-upload.s3.us-east-2.amazonaws.com/angels.png",
        outcomeLogoUrl: "https://polymarket-upload.s3.us-east-2.amazonaws.com/angels.png",
        logoSource: "polymarket",
        polymarketTeamId: 7001,
        polymarketTeamAbbreviation: "LAA",
        polymarketTeamName: "Los Angeles Angels",
      },
      {
        name: "Detroit Tigers",
        polymarketTeamLogoUrl: "https://polymarket-upload.s3.us-east-2.amazonaws.com/tigers.png",
        outcomeLogoUrl: "https://polymarket-upload.s3.us-east-2.amazonaws.com/tigers.png",
        logoSource: "polymarket",
        polymarketTeamId: 7002,
        polymarketTeamAbbreviation: "DET",
        polymarketTeamName: "Detroit Tigers",
      },
    ]);
    expect(market.outcomeOptions?.[0]?.teamDisplayName).toBe("Los Angeles Angels");
    expect(market.outcomeOptions?.[1]?.teamDisplayName).toBe("Detroit Tigers");
  });

  it("normalizes duplicated Polymarket upload prefixes in team logos", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("gamma-api.polymarket.com/teams")) {
          return new Response(
            JSON.stringify([
              {
                id: 118530,
                name: "Rayo Vallecano de Madrid",
                alias: "Rayo Vallecano de Madrid",
                abbreviation: "ray",
                logo: "https://polymarket-upload.s3.us-east-2.amazonaws.com/https://polymarket-upload.s3.us-east-2.amazonaws.com/Rayo Vallecano de Madrid-145c4f8af9.png-cd975d6f63.png",
              },
            ]),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }),
    );

    const resolved = await resolvePolymarketTeamLogo("Rayo Vallecano de Madrid");

    expect(resolved.logoUrl).toBe("https://polymarket-upload.s3.us-east-2.amazonaws.com/Rayo Vallecano de Madrid-145c4f8af9.png-cd975d6f63.png");
  });

  it("uses different Polymarket team logos for PSG vs Arsenal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("gamma-api.polymarket.com/teams")) {
          return new Response(
            JSON.stringify([
              { id: 8001, name: "Paris Saint-Germain", alias: "PSG", abbreviation: "PSG", logo: "https://polymarket-upload.s3.us-east-2.amazonaws.com/psg.png" },
              { id: 8002, name: "Arsenal", alias: "Arsenal FC", abbreviation: "ARS", logo: "https://polymarket-upload.s3.us-east-2.amazonaws.com/arsenal.png" },
            ]),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }),
    );

    const [market] = await enrichMarketOutcomeLogos([
      {
        id: "psg-arsenal",
        conditionId: "condition",
        slug: "psg-arsenal",
        title: "Paris Saint-Germain FC vs. Arsenal FC",
        sport: "Soccer",
        league: "Soccer",
        status: "upcoming",
        startTime: "2026-06-01T00:00:00.000Z",
        endTime: null,
        yesPrice: 0.5,
        noPrice: 0.5,
        volume24h: 10000,
        volume: 10000,
        liquidity: 5000,
        priceMove24h: 0,
        volume1wk: 10000,
        volumeAcceleration: 0,
        spread: 0.02,
        recentTradesCount: 0,
        opportunityScore: 1,
        outcomes: { yes: "PSG", no: "ARS" },
        tokenIds: { yes: "psg", no: "ars" },
        outcomeOptions: [
          { name: "PSG", price: 0.52, tokenId: "psg" },
          { name: "ARS", price: 0.48, tokenId: "ars" },
        ],
        source: "polymarket",
      } satisfies TerminalMarket,
    ]);

    expect(market.outcomeOptions).toMatchObject([
      {
        name: "PSG",
        polymarketTeamLogoUrl: "https://polymarket-upload.s3.us-east-2.amazonaws.com/psg.png",
        outcomeLogoUrl: "https://polymarket-upload.s3.us-east-2.amazonaws.com/psg.png",
        teamDisplayName: "Paris Saint-Germain",
      },
      {
        name: "ARS",
        polymarketTeamLogoUrl: "https://polymarket-upload.s3.us-east-2.amazonaws.com/arsenal.png",
        outcomeLogoUrl: "https://polymarket-upload.s3.us-east-2.amazonaws.com/arsenal.png",
        teamDisplayName: "Arsenal",
      },
    ]);
  });

  it("strips line suffixes and still resolves team logos", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("gamma-api.polymarket.com/teams")) {
          return new Response(
            JSON.stringify([
              { id: 8101, name: "Rayo Vallecano de Madrid", alias: "Rayo Vallecano", abbreviation: "RAY", logo: "https://polymarket-upload.s3.us-east-2.amazonaws.com/rayo.png" },
            ]),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }),
    );

    const [market] = await enrichMarketOutcomeLogos([
      {
        id: "rayo-line",
        conditionId: "condition",
        slug: "rayo-line",
        title: "Crystal Palace FC vs. Rayo Vallecano De Madrid",
        sport: "Soccer",
        league: "Soccer",
        status: "upcoming",
        startTime: "2026-06-01T00:00:00.000Z",
        endTime: null,
        yesPrice: 0.5,
        noPrice: 0.5,
        volume24h: 10000,
        volume: 10000,
        liquidity: 5000,
        priceMove24h: 0,
        volume1wk: 10000,
        volumeAcceleration: 0,
        spread: 0.02,
        recentTradesCount: 0,
        opportunityScore: 1,
        outcomes: { yes: "Rayo Vallecano De Madrid 1 5", no: "Crystal Palace" },
        tokenIds: { yes: "rayo", no: "palace" },
        outcomeOptions: [
          { name: "Rayo Vallecano De Madrid 1 5", price: 0.52, tokenId: "rayo" },
          { name: "Crystal Palace", price: 0.48, tokenId: "palace" },
        ],
        source: "polymarket",
      } satisfies TerminalMarket,
    ]);

    expect(market.outcomeOptions?.[0]).toMatchObject({
      name: "Rayo Vallecano De Madrid 1 5",
      polymarketTeamLogoUrl: "https://polymarket-upload.s3.us-east-2.amazonaws.com/rayo.png",
      outcomeLogoUrl: "https://polymarket-upload.s3.us-east-2.amazonaws.com/rayo.png",
      teamDisplayName: "Rayo Vallecano De Madrid",
    });
  });

  it("rejects wrong SportsMonks search results", async () => {
    vi.stubEnv("SPORTSMONKS_API_KEY", "sportsmonks-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: [{ id: 8, name: "Liverpool", image_path: "https://cdn.sportmonks.com/images/soccer/teams/8/8.png" }],
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(resolveSportsLogo({ category: "Soccer", sport: "Soccer", marketTitle: "Cup winner", outcomeName: "Unknown Rovers FC" })).resolves.toMatchObject({
      logoUrl: null,
      teamName: "Unknown Rovers",
      teamDisplayName: "Unknown Rovers",
      source: "fallback",
      logoSource: "fallback",
      confidence: "fallback",
      rejectionReason: "no confident provider logo match",
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

    expect(result).toMatchObject({
      logoUrl: "https://r2.thesportsdb.com/images/media/team/badge/brighton.png",
      teamName: "Brighton and Hove Albion",
      teamDisplayName: "Brighton and Hove Albion",
      source: "thesportsdb",
      logoSource: "thesportsdb",
      confidence: "provider_exact_name",
    });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("search_all_teams.php"), { cache: "no-store" });
  });

  it("resolves Liverpool FC only from a matching Liverpool record", async () => {
    vi.stubEnv("THESPORTSDB_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("search_all_teams.php")) {
          return new Response(
            JSON.stringify({
              teams: [
                { strTeam: "Liverpool", strTeamAlternate: "Liverpool FC", strBadge: "https://r2.thesportsdb.com/liverpool.png" },
                { strTeam: "Brentford", strTeamAlternate: "Brentford FC", strBadge: "https://r2.thesportsdb.com/brentford.png" },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ teams: [{ strTeam: "Arsenal", strBadge: "https://r2.thesportsdb.com/arsenal.png" }] }), { status: 200 });
      }),
    );

    await expect(resolveSportsLogo({ category: "EPL", sport: "Soccer", marketTitle: "Premier League winner", outcomeName: "Liverpool FC" })).resolves.toMatchObject({
      logoUrl: "https://r2.thesportsdb.com/liverpool.png",
      teamName: "Liverpool",
      teamDisplayName: "Liverpool",
      source: "thesportsdb",
      logoSource: "thesportsdb",
      confidence: "provider_exact_name",
    });
    await expect(resolveSportsLogo({ category: "EPL", sport: "Soccer", marketTitle: "Premier League winner", outcomeName: "Brentford FC" })).resolves.toMatchObject({
      logoUrl: "https://r2.thesportsdb.com/brentford.png",
      teamName: "Brentford",
      teamDisplayName: "Brentford",
      source: "thesportsdb",
      logoSource: "thesportsdb",
      confidence: "provider_exact_name",
    });
  });

  it("resolves Arsenal FC and rejects wrong generic search results", async () => {
    vi.stubEnv("THESPORTSDB_API_KEY", "test-key");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("search_all_teams.php")) {
        return new Response(
          JSON.stringify({
            teams: [{ strTeam: "Arsenal", strTeamAlternate: "Arsenal FC, Arsenal Football Club", strBadge: "https://r2.thesportsdb.com/arsenal.png" }],
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ teams: [{ strTeam: "Liverpool", strBadge: "https://r2.thesportsdb.com/liverpool.png" }] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolveSportsLogo({ category: "EPL", sport: "Soccer", marketTitle: "Premier League winner", outcomeName: "Arsenal FC" })).resolves.toMatchObject({
      logoUrl: "https://r2.thesportsdb.com/arsenal.png",
      teamName: "Arsenal",
      teamDisplayName: "Arsenal",
      source: "thesportsdb",
      logoSource: "thesportsdb",
      confidence: "provider_exact_name",
    });

    resetSportsLogoCache();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("search_all_teams.php")) return new Response(JSON.stringify({ teams: [] }), { status: 200 });
        return new Response(JSON.stringify({ teams: [{ strTeam: "Liverpool", strBadge: "https://r2.thesportsdb.com/liverpool.png" }] }), { status: 200 });
      }),
    );

    await expect(resolveSportsLogo({ category: "Soccer", sport: "Soccer", marketTitle: "Cup winner", outcomeName: "Unknown Rovers FC" })).resolves.toMatchObject({
      logoUrl: null,
      teamName: "Unknown Rovers",
      teamDisplayName: "Unknown Rovers",
      source: "fallback",
      logoSource: "fallback",
      confidence: "fallback",
      rejectionReason: "no confident provider logo match",
    });
  });
});

