import { describe, expect, it } from "vitest";
import { extractMarketTeams } from "@/lib/sports/marketTeamExtractor";

describe("market team extractor", () => {
  it("extracts Crystal Palace and Arsenal from a soccer matchup", () => {
    const result = extractMarketTeams({
      marketTitle: "Crystal Palace FC vs. Arsenal FC",
      category: "Soccer",
      outcomes: ["Crystal Palace", "Arsenal"],
    });

    expect(result.canonicalTeams).toEqual(["Crystal Palace", "Arsenal"]);
  });

  it("maps each Crystal Palace vs Arsenal outcome to the correct side", () => {
    const result = extractMarketTeams({
      marketTitle: "Crystal Palace FC vs. Arsenal FC",
      category: "Soccer",
      outcomes: ["Crystal Palace", "Arsenal"],
    });

    expect(result.outcomeTeamMap).toEqual({
      "Crystal Palace": "Crystal Palace",
      Arsenal: "Arsenal",
    });
  });

  it("does not map both duplicated soccer outcomes to Arsenal", () => {
    const result = extractMarketTeams({
      marketTitle: "Crystal Palace FC vs. Arsenal FC",
      category: "Soccer",
      outcomes: ["Arsenal", "Arsenal 2"],
    });

    expect(result.outcomeTeamMap).toEqual({
      Arsenal: "Crystal Palace",
      "Arsenal 2": "Arsenal",
    });
  });

  it("extracts Liverpool and Brentford from a More Markets title", () => {
    const result = extractMarketTeams({
      marketTitle: "Liverpool FC vs. Brentford FC - More Markets",
      category: "Soccer",
      outcomes: ["Liverpool", "Brentford", "O/U 4.5"],
    });

    expect(result.canonicalTeams).toEqual(["Liverpool", "Brentford"]);
    expect(result.outcomeTeamMap.Liverpool).toBe("Liverpool");
    expect(result.outcomeTeamMap.Brentford).toBe("Brentford");
  });

  it("does not resolve O/U 4.5 as a team", () => {
    const result = extractMarketTeams({
      marketTitle: "Liverpool FC vs. Brentford FC - More Markets",
      category: "Soccer",
      outcomes: ["O/U 4.5"],
    });

    expect(result.outcomeTeamMap["O/U 4.5"]).toBeNull();
    expect(result.isTeamOutcome).toBe(false);
  });

  it("resolves a team name even when the outcome includes a trailing betting line", () => {
    const result = extractMarketTeams({
      marketTitle: "Crystal Palace FC vs. Rayo Vallecano De Madrid",
      category: "Soccer",
      outcomes: ["Rayo Vallecano De Madrid 1 5"],
    });

    expect(result.canonicalTeams).toEqual(["Crystal Palace", "Rayo Vallecano De Madrid"]);
    expect(result.outcomeTeamMap["Rayo Vallecano De Madrid 1 5"]).toBe("Rayo Vallecano De Madrid");
  });

  it("keeps Yes and No outcomes on the sport fallback", () => {
    const result = extractMarketTeams({
      marketTitle: "Will Arsenal win?",
      category: "Soccer",
      outcomes: ["Yes", "No"],
    });

    expect(result.outcomeTeamMap).toEqual({ Yes: null, No: null });
    expect(result.isTeamOutcome).toBe(false);
  });

  it("treats Both Teams To Score as a non-team outcome", () => {
    const result = extractMarketTeams({
      marketTitle: "Liverpool FC vs. Brentford FC - More Markets",
      category: "Soccer",
      outcomes: ["Both Teams To Score"],
    });

    expect(result.outcomeTeamMap["Both Teams To Score"]).toBeNull();
    expect(result.isTeamOutcome).toBe(false);
  });

  it("resolves NBA championship outcomes to full NBA team names", () => {
    const result = extractMarketTeams({
      marketTitle: "2026 NBA Champion",
      category: "NBA",
      outcomes: ["Spurs", "Knicks", "Thunder"],
    });

    expect(result.outcomeTeamMap).toEqual({
      Spurs: "San Antonio Spurs",
      Knicks: "New York Knicks",
      Thunder: "Oklahoma City Thunder",
    });
  });

  it("maps PSG and ARS abbreviations through canonical market teams", () => {
    const result = extractMarketTeams({
      marketTitle: "Paris Saint-Germain FC vs. Arsenal FC",
      category: "Soccer",
      outcomes: ["PSG", "ARS"],
    });

    expect(result.canonicalTeams).toEqual(["Paris Saint-Germain", "Arsenal"]);
    expect(result.outcomeTeamMap).toEqual({
      PSG: "Paris Saint-Germain",
      ARS: "Arsenal",
    });
  });

  it("canonicalizes country outcomes in national team markets", () => {
    const result = extractMarketTeams({
      marketTitle: "2026 FIFA World Cup Winner",
      category: "Soccer",
      outcomes: ["USA", "France", "England"],
    });

    expect(result.outcomeTeamMap).toEqual({
      USA: "United States",
      France: "France",
      England: "England",
    });
  });
});
