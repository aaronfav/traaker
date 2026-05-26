import { TEAM_ALIASES, TEAM_SUFFIX_PATTERN } from "@/lib/sports/teamAliases";

export type MarketTeamExtractionInput = {
  marketTitle?: string;
  category?: string;
  sport?: string;
  outcomes?: string[];
};

export type MarketTeamExtraction = {
  canonicalTeams: string[];
  outcomeTeamMap: Record<string, string | null>;
  isTeamOutcome: boolean;
};

const CHAMPIONSHIP_WORDS =
  /\b(to win|winner|wins?|champions?|championship|finals?|playoffs?|league|cup|season|outright|market|moneyline|advance|qualify)\b/gi;

const NBA_ALIASES: Record<string, string> = {
  "new york knicks": "New York Knicks",
  knicks: "New York Knicks",
  "okc thunder": "Oklahoma City Thunder",
  "oklahoma city thunder": "Oklahoma City Thunder",
  okc: "Oklahoma City Thunder",
  thunder: "Oklahoma City Thunder",
  "san antonio spurs": "San Antonio Spurs",
  spurs: "San Antonio Spurs",
};

export function compactTeamText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function titleCase(value: string) {
  const uppercaseWords = new Set(["afc", "cf", "fc", "mls", "nba", "nfl", "psg", "sc", "ufc"]);
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => (uppercaseWords.has(word) ? word.toUpperCase() : `${word[0]?.toUpperCase() ?? ""}${word.slice(1).toLowerCase()}`))
    .join(" ");
}

export function stripTeamSuffix(value: string) {
  return compactTeamText(value).replace(TEAM_SUFFIX_PATTERN, " ").replace(/\s+/g, " ").trim();
}

function contextualAliases(category?: string, sport?: string) {
  const normalizedCategory = normalizeCategory(category, sport);
  if (normalizedCategory === "NBA") return { ...TEAM_ALIASES, ...NBA_ALIASES };
  return TEAM_ALIASES;
}

function normalizeCategory(category?: string, sport?: string) {
  const value = compactTeamText(`${category ?? ""} ${sport ?? ""}`);
  if (/\bnba|basketball|wnba\b/.test(value)) return "NBA";
  if (/\bnfl|american football|super bowl\b/.test(value)) return "NFL";
  if (/\bsoccer|premier league|champions league|ucl|epl|uefa|fifa|mls|laliga|serie a|bundesliga\b/.test(value)) return "Soccer";
  if (/\bufc|mma|fight|fighter|boxing\b/.test(value)) return "UFC";
  if (/\btennis|atp|wta|wimbledon|french open|us open|australian open\b/.test(value)) return "Tennis";
  return category || sport || "Market";
}

export function canonicalTeamName(value: string, category?: string, sport?: string) {
  const aliases = contextualAliases(category, sport);
  const normalized = compactTeamText(value).replace(CHAMPIONSHIP_WORDS, " ").replace(/\s+/g, " ").trim();
  const withoutSuffix = stripTeamSuffix(normalized);
  if (!withoutSuffix) return null;
  return aliases[normalized] ?? aliases[withoutSuffix] ?? titleCase(withoutSuffix);
}

function teamAliasMatches(candidate: string, canonicalTeam: string, category?: string, sport?: string) {
  const aliases = contextualAliases(category, sport);
  const normalizedCandidate = compactTeamText(candidate).replace(/\b\d+\b$/g, "").replace(/\s+/g, " ").trim();
  const candidateWithoutSuffix = stripTeamSuffix(normalizedCandidate);
  const normalizedTeam = compactTeamText(canonicalTeam);
  const teamWithoutSuffix = stripTeamSuffix(canonicalTeam);

  if (normalizedCandidate === normalizedTeam || candidateWithoutSuffix === teamWithoutSuffix) return true;
  const aliasedCandidate = aliases[normalizedCandidate] ?? aliases[candidateWithoutSuffix];
  return aliasedCandidate ? compactTeamText(aliasedCandidate) === normalizedTeam : false;
}

export function isNonTeamOutcome(value: string) {
  const raw = value.trim();
  const normalized = compactTeamText(raw);
  if (!normalized) return true;
  if (/^(yes|no|over|under|ou|o u|draw|tie|draw tie|field|other|none|push|market|winner|champion|team)$/.test(normalized)) return true;
  if (/^(?:o\s*\/\s*u|ou|o u|over|under)\s*[-+]?\d+(?:\.\d+)?$/i.test(raw)) return true;
  if (/^[-+]?\d+(?:\.\d+)?$/.test(raw)) return true;
  if (/^[-+]?\d+(?:\.\d+)?\s*(?:points?|pts?|goals?|runs?|yards?)$/i.test(raw)) return true;
  if (/\b(?:total|spread|handicap|player prop|props?|points?|rebounds?|assists?|saves?|shots?|yards?|touchdowns?|tds?|goalscorer)\b/i.test(raw)) return true;
  return false;
}

function cleanMatchupSegment(value: string) {
  return value
    .replace(/\?.*$/, "")
    .replace(/\s+-\s+.*$/, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(CHAMPIONSHIP_WORDS, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitleTeams(marketTitle: string, category?: string, sport?: string) {
  const normalizedTitle = marketTitle.replace(/\s+/g, " ").trim();
  if (!normalizedTitle) return [];

  const parts = normalizedTitle.split(/\s+(?:vs\.?|v\.?|versus|at|@)\s+/i);
  if (parts.length < 2) return [];

  return parts
    .slice(0, 2)
    .map(cleanMatchupSegment)
    .map((team) => canonicalTeamName(team, category, sport))
    .filter((team): team is string => Boolean(team));
}

function uniqueTeams(teams: string[]) {
  const seen = new Set<string>();
  return teams.filter((team) => {
    const key = compactTeamText(team);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mapOutcomeToTitleTeam(outcome: string, titleTeams: string[], category?: string, sport?: string) {
  if (isNonTeamOutcome(outcome)) return null;
  return titleTeams.find((team) => teamAliasMatches(outcome, team, category, sport)) ?? null;
}

function hasDuplicateResolvedTeams(mappedTeams: Array<string | null>) {
  const present = mappedTeams.filter((team): team is string => Boolean(team));
  return present.length > 1 && new Set(present.map(compactTeamText)).size < present.length;
}

export function extractMarketTeams(input: MarketTeamExtractionInput): MarketTeamExtraction {
  const outcomes = input.outcomes ?? [];
  const titleTeams = uniqueTeams(extractTitleTeams(input.marketTitle ?? "", input.category, input.sport));
  const outcomeTeamMap: Record<string, string | null> = {};
  let mappedTeams = outcomes.map((outcome) => mapOutcomeToTitleTeam(outcome, titleTeams, input.category, input.sport));

  if (titleTeams.length === 2 && outcomes.length === 2 && hasDuplicateResolvedTeams(mappedTeams) && outcomes.every((outcome) => !isNonTeamOutcome(outcome))) {
    mappedTeams = [titleTeams[0], titleTeams[1]];
  }

  outcomes.forEach((outcome, index) => {
    if (titleTeams.length > 0) {
      outcomeTeamMap[outcome] = mappedTeams[index] ?? null;
      return;
    }

    outcomeTeamMap[outcome] = isNonTeamOutcome(outcome) ? null : canonicalTeamName(outcome, input.category, input.sport);
  });

  return {
    canonicalTeams: titleTeams,
    outcomeTeamMap,
    isTeamOutcome: Object.values(outcomeTeamMap).some(Boolean),
  };
}
