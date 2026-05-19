export type TeamStyle = {
  aliases: string[];
  primary: string;
  secondary: string;
  logoUrl?: string;
};

export const TEAM_STYLES = {
  arsenal: {
    aliases: ["arsenal", "gunners"],
    primary: "#EF0107",
    secondary: "#FFFFFF",
  },
  real_madrid: {
    aliases: ["real madrid", "madrid"],
    primary: "#FFFFFF",
    secondary: "#FEBE10",
  },
  lakers: {
    aliases: ["lakers", "los angeles lakers", "la lakers"],
    primary: "#552583",
    secondary: "#FDB927",
  },
  celtics: {
    aliases: ["celtics", "boston celtics"],
    primary: "#007A33",
    secondary: "#FFFFFF",
  },
  knicks: {
    aliases: ["knicks", "new york knicks"],
    primary: "#006BB6",
    secondary: "#F58426",
  },
  warriors: {
    aliases: ["warriors", "golden state warriors"],
    primary: "#1D428A",
    secondary: "#FFC72C",
  },
  dodgers: {
    aliases: ["dodgers", "los angeles dodgers"],
    primary: "#005A9C",
    secondary: "#FFFFFF",
  },
  yankees: {
    aliases: ["yankees", "new york yankees"],
    primary: "#0C2340",
    secondary: "#FFFFFF",
  },
  cowboys: {
    aliases: ["cowboys", "dallas cowboys"],
    primary: "#041E42",
    secondary: "#869397",
  },
  chiefs: {
    aliases: ["chiefs", "kansas city chiefs"],
    primary: "#E31837",
    secondary: "#FFB81C",
  },
  maple_leafs: {
    aliases: ["maple leafs", "toronto maple leafs", "leafs"],
    primary: "#00205B",
    secondary: "#FFFFFF",
  },
  canadiens: {
    aliases: ["canadiens", "montreal canadiens", "habs"],
    primary: "#AF1E2D",
    secondary: "#192168",
  },
  manchester_united: {
    aliases: ["manchester united", "man united", "man utd"],
    primary: "#DA291C",
    secondary: "#FBE122",
  },
  chelsea: {
    aliases: ["chelsea", "chelsea fc"],
    primary: "#034694",
    secondary: "#FFFFFF",
  },
} satisfies Record<string, TeamStyle>;

const SPORT_FALLBACKS = {
  nba: { primary: "#F57C00", secondary: "#1D428A" },
  basketball: { primary: "#F57C00", secondary: "#1D428A" },
  nfl: { primary: "#013369", secondary: "#FFFFFF" },
  football: { primary: "#013369", secondary: "#FFFFFF" },
  soccer: { primary: "#00A86B", secondary: "#FFFFFF" },
  ufc: { primary: "#111111", secondary: "#D20A0A" },
  mma: { primary: "#111111", secondary: "#D20A0A" },
  tennis: { primary: "#B6FF2E", secondary: "#FFFFFF" },
  mlb: { primary: "#002D72", secondary: "#D50032" },
  baseball: { primary: "#002D72", secondary: "#D50032" },
  nhl: { primary: "#111827", secondary: "#FFFFFF" },
  hockey: { primary: "#111827", secondary: "#FFFFFF" },
  ncaa: { primary: "#1E40AF", secondary: "#FFFFFF" },
  wnba: { primary: "#FF6A00", secondary: "#FFFFFF" },
  golf: { primary: "#15803D", secondary: "#FFFFFF" },
  boxing: { primary: "#7F1D1D", secondary: "#FFFFFF" },
  cricket: { primary: "#0F766E", secondary: "#FFFFFF" },
  f1: { primary: "#E10600", secondary: "#FFFFFF" },
  racing: { primary: "#E10600", secondary: "#FFFFFF" },
  unknown: { primary: "#22D3EE", secondary: "#334155" },
} satisfies Record<string, { primary: string; secondary: string }>;

export function findTeamStyleMatch(title: string) {
  const normalizedTitle = title.toLowerCase();
  for (const style of Object.values(TEAM_STYLES) as TeamStyle[]) {
    if (style.aliases.some((alias) => normalizedTitle.includes(alias))) {
      return style.logoUrl ? { primary: style.primary, secondary: style.secondary, logoUrl: style.logoUrl } : { primary: style.primary, secondary: style.secondary };
    }
  }
  return null;
}

export function findTeamStyle(title: string, sport: string) {
  const matchedStyle = findTeamStyleMatch(title);
  if (matchedStyle) return matchedStyle;
  const normalizedSport = sport.toLowerCase();
  const fallbackKey = Object.keys(SPORT_FALLBACKS).find((key) => normalizedSport.includes(key)) ?? "unknown";
  return SPORT_FALLBACKS[fallbackKey as keyof typeof SPORT_FALLBACKS];
}

export function marketBubbleRadius(volume: number) {
  const numericVolume = Number.isFinite(volume) ? Math.max(0, volume) : 0;
  return Math.max(34, Math.min(155, 28 + Math.log10(numericVolume + 1) * 19));
}

export function momentumGlowColor(priceChange: number, volume: number) {
  if (volume >= 1_000_000) return "rgba(251, 191, 36, 0.92)";
  if (priceChange > 0.005) return "rgba(52, 211, 153, 0.85)";
  if (priceChange < -0.005) return "rgba(251, 113, 133, 0.85)";
  return "rgba(34, 211, 238, 0.72)";
}
