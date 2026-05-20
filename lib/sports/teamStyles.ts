export type TeamStyle = {
  aliases: string[];
  primary: string;
  secondary: string;
  logoPath?: string;
  logoUrl?: string;
};

export const TEAM_STYLES = {
  arsenal: {
    aliases: ["arsenal", "gunners"],
    primary: "#EF0107",
    secondary: "#FFFFFF",
    logoPath: "/team-logos/arsenal.svg",
  },
  real_madrid: {
    aliases: ["real madrid", "madrid"],
    primary: "#FFFFFF",
    secondary: "#FEBE10",
    logoPath: "/team-logos/real-madrid.svg",
  },
  lakers: {
    aliases: ["lakers", "los angeles lakers", "la lakers"],
    primary: "#552583",
    secondary: "#FDB927",
    logoPath: "/team-logos/lakers.svg",
  },
  celtics: {
    aliases: ["celtics", "boston celtics"],
    primary: "#007A33",
    secondary: "#FFFFFF",
    logoPath: "/team-logos/celtics.svg",
  },
  thunder: {
    aliases: ["thunder", "oklahoma city thunder", "okc"],
    primary: "#EF3B24",
    secondary: "#007AC1",
    logoPath: "/team-logos/thunder.svg",
  },
  knicks: {
    aliases: ["knicks", "new york knicks"],
    primary: "#006BB6",
    secondary: "#F58426",
    logoPath: "/team-logos/knicks.svg",
  },
  warriors: {
    aliases: ["warriors", "golden state warriors"],
    primary: "#1D428A",
    secondary: "#FFC72C",
    logoPath: "/team-logos/warriors.svg",
  },
  dodgers: {
    aliases: ["dodgers", "los angeles dodgers"],
    primary: "#005A9C",
    secondary: "#FFFFFF",
    logoPath: "/team-logos/dodgers.svg",
  },
  red_sox: {
    aliases: ["red sox", "boston red sox"],
    primary: "#BD3039",
    secondary: "#FFFFFF",
  },
  yankees: {
    aliases: ["yankees", "new york yankees"],
    primary: "#0C2340",
    secondary: "#FFFFFF",
    logoPath: "/team-logos/yankees.svg",
  },
  cowboys: {
    aliases: ["cowboys", "dallas cowboys"],
    primary: "#041E42",
    secondary: "#869397",
    logoPath: "/team-logos/cowboys.svg",
  },
  chiefs: {
    aliases: ["chiefs", "kansas city chiefs"],
    primary: "#E31837",
    secondary: "#FFB81C",
    logoPath: "/team-logos/chiefs.svg",
  },
  eagles: {
    aliases: ["eagles", "philadelphia eagles"],
    primary: "#004C54",
    secondary: "#A5ACAF",
    logoPath: "/team-logos/eagles.svg",
  },
  forty_niners: {
    aliases: ["49ers", "san francisco 49ers", "niners"],
    primary: "#AA0000",
    secondary: "#B3995D",
    logoPath: "/team-logos/49ers.svg",
  },
  packers: {
    aliases: ["packers", "green bay packers"],
    primary: "#203731",
    secondary: "#FFB612",
  },
  bayern: {
    aliases: ["bayern", "bayern munich"],
    primary: "#DC052D",
    secondary: "#FFFFFF",
    logoPath: "/team-logos/bayern.svg",
  },
  barcelona: {
    aliases: ["barcelona", "barca"],
    primary: "#004D98",
    secondary: "#A50044",
    logoPath: "/team-logos/barcelona.svg",
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
    logoPath: "/team-logos/chelsea.svg",
  },
  liverpool: {
    aliases: ["liverpool", "liverpool fc", "reds"],
    primary: "#C8102E",
    secondary: "#00B2A9",
    logoPath: "/team-logos/liverpool.svg",
  },
  man_city: {
    aliases: ["man city", "manchester city", "manchester city fc"],
    primary: "#6CABDD",
    secondary: "#FFFFFF",
    logoPath: "/team-logos/man-city.svg",
  },
  psg: {
    aliases: ["psg", "paris saint-germain", "paris saint germain"],
    primary: "#004170",
    secondary: "#DA291C",
    logoPath: "/team-logos/psg.svg",
  },
  nba: {
    aliases: ["nba", "national basketball association"],
    primary: "#1D428A",
    secondary: "#C8102E",
  },
  nfl: {
    aliases: ["nfl", "national football league", "super bowl"],
    primary: "#013369",
    secondary: "#D50A0A",
  },
  mlb: {
    aliases: ["mlb", "major league baseball", "world series"],
    primary: "#002D72",
    secondary: "#D50032",
  },
  nhl: {
    aliases: ["nhl", "national hockey league", "stanley cup"],
    primary: "#111827",
    secondary: "#D1D5DB",
  },
  epl: {
    aliases: ["epl", "premier league", "english premier league"],
    primary: "#3D195B",
    secondary: "#00FF85",
  },
  la_liga: {
    aliases: ["la liga", "laliga", "spanish league"],
    primary: "#EE8707",
    secondary: "#111827",
  },
  ucl: {
    aliases: ["ucl", "champions league", "uefa champions league"],
    primary: "#003B79",
    secondary: "#F4F7FF",
  },
  f1: {
    aliases: ["f1", "formula 1", "formula one", "grand prix"],
    primary: "#E10600",
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
      const matched: TeamStyle = {
        aliases: style.aliases,
        primary: style.primary,
        secondary: style.secondary,
      };
      if (style.logoPath) matched.logoPath = style.logoPath;
      if (style.logoUrl) matched.logoUrl = style.logoUrl;
      return matched;
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
  return Math.max(42, Math.min(115, 38 + Math.log10(numericVolume + 1) * 13));
}

export function momentumGlowColor(priceChange: number, volume: number) {
  if (volume >= 1_000_000) return "rgba(251, 191, 36, 0.92)";
  if (priceChange > 0.005) return "rgba(52, 211, 153, 0.85)";
  if (priceChange < -0.005) return "rgba(251, 113, 133, 0.85)";
  return "rgba(34, 211, 238, 0.72)";
}
