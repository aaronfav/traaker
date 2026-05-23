import { describe, expect, it } from "vitest";
import { deriveMarketCategory } from "@/lib/markets/category";

describe("deriveMarketCategory", () => {
  it("maps Cavaliers and Knicks markets to NBA", () => {
    expect(
      deriveMarketCategory({
        title: "Knicks vs Cavaliers",
        league: "NBA",
        tags: ["basketball"],
      }),
    ).toBe("NBA");
  });

  it("maps football to Soccer unless NFL is explicit", () => {
    expect(deriveMarketCategory({ title: "Arsenal vs Chelsea", tags: ["football"] })).toBe("Soccer");
    expect(deriveMarketCategory({ title: "Chiefs vs Eagles", tags: ["nfl"] })).toBe("NFL");
  });
});
