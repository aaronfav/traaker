import { describe, expect, it } from "vitest";
import { findTeamStyle, marketBubbleRadius, momentumGlowColor } from "@/lib/sports/teamStyles";

describe("teamStyles", () => {
  it("matches team aliases to uniform colors", () => {
    expect(findTeamStyle("Arsenal vs Chelsea", "Soccer")).toEqual({ primary: "#EF0107", secondary: "#FFFFFF" });
    expect(findTeamStyle("Los Angeles Lakers moneyline", "NBA")).toEqual({ primary: "#552583", secondary: "#FDB927" });
    expect(findTeamStyle("Real Madrid to win", "Soccer")).toEqual({ primary: "#FFFFFF", secondary: "#FEBE10" });
  });

  it("falls back to sport colors", () => {
    expect(findTeamStyle("Unknown cup winner", "Soccer")).toEqual({ primary: "#00A86B", secondary: "#FFFFFF" });
    expect(findTeamStyle("Unknown fight winner", "UFC")).toEqual({ primary: "#111111", secondary: "#D20A0A" });
    expect(findTeamStyle("Unknown match", "Unknown")).toEqual({ primary: "#22D3EE", secondary: "#334155" });
  });

  it("compresses bubble radius and clamps extremes", () => {
    expect(marketBubbleRadius(0)).toBe(18);
    expect(marketBubbleRadius(100_000)).toBeGreaterThan(100);
    expect(marketBubbleRadius(1_000_000_000)).toBe(110);
  });

  it("uses glow for momentum and high volume", () => {
    expect(momentumGlowColor(0.02, 10_000)).toContain("52, 211, 153");
    expect(momentumGlowColor(-0.02, 10_000)).toContain("251, 113, 133");
    expect(momentumGlowColor(0, 2_000_000)).toContain("251, 191, 36");
  });
});
