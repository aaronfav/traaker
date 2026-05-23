export type MarketCategoryLabel = "NBA" | "NFL" | "Soccer" | "UFC" | "Tennis" | "Market";

const categoryPatterns: Array<{ label: Exclude<MarketCategoryLabel, "Market">; pattern: RegExp }> = [
  { label: "NBA", pattern: /\b(nba|basketball|wnba|cavaliers|knicks|lakers|celtics|warriors|heat|thunder|mavericks|suns|nuggets|bulls|76ers)\b/i },
  { label: "NFL", pattern: /\b(nfl|american football|chiefs|eagles|cowboys|49ers|super bowl)\b/i },
  { label: "Soccer", pattern: /\b(soccer|football|premier league|champions league|ucl|epl|uefa|fifa|mls|laliga|serie a|bundesliga|arsenal|chelsea|liverpool|barcelona|madrid|psg|bayern|man city)\b/i },
  { label: "UFC", pattern: /\b(ufc|mma|fight|fighter)\b/i },
  { label: "Tennis", pattern: /\b(tennis|atp|wta|wimbledon|french open|us open|australian open)\b/i },
];

export function deriveMarketCategory(input: {
  title?: string | null;
  sport?: string | null;
  league?: string | null;
  category?: string | null;
  tags?: unknown;
  series?: unknown;
}) {
  const haystack = [
    input.league,
    input.sport,
    input.category,
    input.title,
    typeof input.tags === "string" ? input.tags : JSON.stringify(input.tags ?? ""),
    typeof input.series === "string" ? input.series : JSON.stringify(input.series ?? ""),
  ]
    .filter(Boolean)
    .join(" ");

  return categoryPatterns.find((item) => item.pattern.test(haystack))?.label ?? "Market";
}

export function categoryIcon(label: string) {
  if (label === "NBA") return "\u{1F3C0}";
  if (label === "NFL") return "\u{1F3C8}";
  if (label === "Soccer") return "\u26BD";
  if (label === "UFC") return "";
  if (label === "Tennis") return "\u{1F3BE}";
  return "";
}
