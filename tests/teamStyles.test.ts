import { describe, expect, it } from "vitest";
import { findTeamStyle, marketBubbleRadius, momentumGlowColor } from "@/lib/sports/teamStyles";

describe("teamStyles", () => {
  it("matches team aliases to uniform colors", () => {
    expect(findTeamStyle("Arsenal vs Chelsea", "Soccer")).toMatchObject({ primary: "#EF0107", secondary: "#FFFFFF", logoPath: "/team-logos/arsenal.svg" });
    expect(findTeamStyle("Los Angeles Lakers moneyline", "NBA")).toMatchObject({ primary: "#552583", secondary: "#FDB927", logoPath: "/team-logos/lakers.svg" });
    expect(findTeamStyle("Real Madrid to win", "Soccer")).toMatchObject({ primary: "#FFFFFF", secondary: "#FEBE10", logoPath: "/team-logos/real-madrid.svg" });
  });

  it("matches requested local team logo assets", () => {
    expect(findTeamStyle("Liverpool title odds", "Soccer")).toMatchObject({ logoPath: "/team-logos/liverpool.svg" });
    expect(findTeamStyle("Man City vs PSG", "Soccer")).toMatchObject({ logoPath: "/team-logos/man-city.svg" });
    expect(findTeamStyle("Oklahoma City Thunder to win", "NBA")).toMatchObject({ logoPath: "/team-logos/thunder.svg" });
  });

  it("supports league styles that fall back to initials when no logo asset exists", () => {
    expect(findTeamStyle("La Liga champion", "Soccer")).toMatchObject({ primary: "#EE8707" });
    expect(findTeamStyle("Formula 1 constructors champion", "F1")).toMatchObject({ primary: "#E10600" });
    expect(findTeamStyle("UCL winner", "Soccer")).not.toHaveProperty("logoPath");
  });

  it("falls back to sport colors", () => {
    expect(findTeamStyle("Unknown cup winner", "Soccer")).toEqual({ primary: "#00A86B", secondary: "#FFFFFF" });
    expect(findTeamStyle("Unknown fight winner", "UFC")).toEqual({ primary: "#111111", secondary: "#D20A0A" });
    expect(findTeamStyle("Unknown match", "Unknown")).toEqual({ primary: "#22D3EE", secondary: "#334155" });
  });

  it("compresses bubble radius and clamps extremes", () => {
    expect(marketBubbleRadius(0)).toBe(42);
    expect(marketBubbleRadius(100_000)).toBeGreaterThan(100);
    expect(marketBubbleRadius(1_000_000_000)).toBe(115);
  });

  it("uses glow for momentum and high volume", () => {
    expect(momentumGlowColor(0.02, 10_000)).toContain("52, 211, 153");
    expect(momentumGlowColor(-0.02, 10_000)).toContain("251, 113, 133");
    expect(momentumGlowColor(0, 2_000_000)).toContain("251, 191, 36");
  });
});
