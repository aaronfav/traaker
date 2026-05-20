"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MarketTradePanel } from "@/components/MarketTradePanel";
import { marketStore, type MarketValueState } from "@/app/store/marketStore";
import { hasUsefulFavoredPrice, isUsefulFavoredPrice } from "@/lib/polymarket/marketDisplay";
import { findTeamStyleMatch, marketBubbleRadius, momentumGlowColor } from "@/lib/sports/teamStyles";
import type { TerminalMarket } from "@/lib/polymarket/types";

export type MarketBubbleNode = {
  id: string;
  conditionId: string;
  title: string;
  sport: string;
  volume: number;
  liquidity: number;
  priceChange: number;
  marketUrl?: string;
  polymarketUrl?: string;
  tradeUrl?: string;
  logoUrl?: string;
  logoPath?: string;
  primaryColor: string;
  secondaryColor: string;
  glowColor: string;
  favoredOutcome: string;
  favoredPrice: number;
  priceCents: number;
  outcomes: MarketOutcomeOption[];
  bestBid?: number;
  bestAsk?: number;
  isLiveHidden?: boolean;
  activeRangeWarning?: boolean;
  visualPulseDirection?: "up" | "down";
  visualPulseStartedAt?: number;
  trendScore: number;
  isTrending: boolean;
  driftPhase: number;
  val: number;
  targetX: number;
  targetY: number;
  x: number;
  y: number;
};

export type MarketOutcomeOption = {
  name: string;
  price: number;
  priceCents: number;
};

type RawOutcomeMarket = TerminalMarket & {
  outcomePrices?: unknown;
  bestBid?: number;
  bestAsk?: number;
  lastTradePrice?: number;
};

type BackgroundParticle = {
  x: number;
  y: number;
  size: number;
  alpha: number;
  color: string;
};

type BackgroundTheme = "neutral" | "soccer" | "basketball" | "football" | "tennis" | "ufc";

export type BubbleBody = MarketBubbleNode & {
  radius: number;
  mass: number;
  vx: number;
  vy: number;
};

export type BubbleVisualSmoothingState = {
  displayedOutcome: string;
  pendingOutcome: string | null;
  pendingOutcomeSince: number;
  priceFrom: number;
  priceTarget: number;
  priceStartedAt: number;
  priceDuration: number;
  lastVisualAppliedAt: number;
  lastReceivedTimestamp: number;
  lastSignature: string;
};

const DESKTOP_COLLISION_PADDING = 6;
const MOBILE_COLLISION_PADDING = 4;
const MAX_BUBBLE_SPEED = 0.35;
const VELOCITY_DAMPING = 0.995;
const WALL_BOUNCE = 0.42;
const COLLISION_BOUNCE = 0.18;
const PRICE_TWEEN_MS = 420;
const PULSE_FADE_MS = 1_000;

const money = (value: number) => {
  const numeric = Number.isFinite(value) ? Math.max(0, value) : 0;
  if (numeric >= 1_000_000_000) return `$${(numeric / 1_000_000_000).toFixed(1)}B`;
  if (numeric >= 1_000_000) return `$${(numeric / 1_000_000).toFixed(1)}M`;
  if (numeric >= 1_000) {
    const thousands = numeric / 1_000;
    return `$${thousands >= 100 ? Math.round(thousands) : thousands.toFixed(1)}k`;
  }
  return `$${Math.round(numeric)}`;
};

const pct = (value: number) => `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
type LogoCacheEntry = {
  image: HTMLImageElement;
  bitmap?: ImageBitmap;
  bitmapLoading: boolean;
  failed: boolean;
};
const logoCache = new Map<string, LogoCacheEntry>();
const imageAssetCache = new Map<string, LogoCacheEntry>();

function safeNumber(value: number, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function safePositiveNumber(value: number, fallback = 0) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function safeCoordinate(value: number | undefined, fallback = 0) {
  return Number.isFinite(value) ? (value as number) : fallback;
}

function safeRadius(value: number, fallback = 1) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, safeNumber(value, 0)));

export const formatCents = (price: number) => `${Math.round(clamp01(price) * 100)}\u00a2`;

function alphaColor(color: string, alpha: number) {
  if (!color.startsWith("#") || !/^#[0-9a-f]{6}$/i.test(color)) return color;
  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

const genericOutcomePattern = /^(yes|no|winner|champion|champions?|market|liquid|gaming|team|field|other|others?|draw\/tie)$/i;
const genericWords = /\b(to win|winner|champions?|championship|market|moneyline|outright|yes|no|will|wins?|advance|qualify|series|game|match|nba|nfl|mlb|nhl|wnba|ncaa|finals?|league|cup|season|playoffs?)\b/gi;

export const cleanOutcomeName = (name: string, marketTitle: string) => {
  const normalized = name.replace(/\s+/g, " ").trim();
  const title = marketTitle.replace(/\s+/g, " ").trim();
  const titleMatchup = title.split(/\s+(?:vs\.?|v\.?|at)\s+/i).filter(Boolean);
  const source = normalized && !genericOutcomePattern.test(normalized) ? normalized : titleMatchup[0] ?? title;
  const sourceMatchup = source.split(/\s+(?:vs\.?|v\.?|at)\s+/i).filter(Boolean);
  let cleaned = (sourceMatchup[0] ?? source)
    .replace(/\?.*$/, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(genericWords, " ")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  if (genericOutcomePattern.test(cleaned) || cleaned.length < 2) {
    cleaned =
      titleMatchup[0]
        ?.replace(/\?.*$/, "")
        .replace(genericWords, " ")
        .replace(/\s+/g, " ")
        .trim() ?? "";
  }

  return cleaned || "Market";
};

function matchupOutcomeName(marketTitle: string, index: number) {
  const side = marketTitle
    .replace(/\?.*$/, "")
    .split(/\s+(?:vs\.?|v\.?|at)\s+/i)
    .map((item) => item.replace(genericWords, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean)[index];
  return side || null;
}

const compactOutcomeName = (name: string) => {
  const cleaned = name.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 13) return cleaned;
  const words = cleaned.split(" ");
  if (words.length > 1) return words.at(-1) ?? cleaned.slice(0, 13);
  return `${cleaned.slice(0, 12)}...`;
};

const parseStringArray = (value: unknown) => {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
};

const parseNumberArray = (value: unknown) => {
  if (Array.isArray(value)) return value.map(Number).filter(Number.isFinite);
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(Number).filter(Number.isFinite) : [];
  } catch {
    return [];
  }
};

function getLogoAsset(logoUrl?: string) {
  if (!logoUrl || typeof window === "undefined") return null;
  const cached = logoCache.get(logoUrl);
  if (cached) return cached;
  const image = new Image();
  image.crossOrigin = "anonymous";
  const entry: LogoCacheEntry = { image, bitmapLoading: false, failed: false };
  image.decoding = "async";
  image.loading = "lazy";
  image.onload = () => {
    if (entry.bitmapLoading || entry.bitmap || !("createImageBitmap" in window)) return;
    entry.bitmapLoading = true;
    void createImageBitmap(image)
      .then((bitmap) => {
        entry.bitmap = bitmap;
      })
      .catch(() => {
        entry.failed = true;
      })
      .finally(() => {
        entry.bitmapLoading = false;
      });
  };
  image.onerror = () => {
    entry.failed = true;
  };
  image.src = logoUrl;
  logoCache.set(logoUrl, entry);
  return entry;
}

function getImageAsset(src?: string) {
  if (!src || typeof window === "undefined") return null;
  const cached = imageAssetCache.get(src);
  if (cached) return cached;
  const image = new Image();
  image.crossOrigin = "anonymous";
  const entry: LogoCacheEntry = { image, bitmapLoading: false, failed: false };
  image.decoding = "async";
  image.loading = "eager";
  image.onload = () => {
    if (entry.bitmapLoading || entry.bitmap || !("createImageBitmap" in window)) return;
    entry.bitmapLoading = true;
    void createImageBitmap(image)
      .then((bitmap) => {
        entry.bitmap = bitmap;
      })
      .catch(() => {
        entry.failed = true;
      })
      .finally(() => {
        entry.bitmapLoading = false;
      });
  };
  image.onerror = () => {
    entry.failed = true;
  };
  image.src = src;
  imageAssetCache.set(src, entry);
  return entry;
}

const hashString = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const seededPosition = (id: string) => {
  const hash = hashString(id);
  const hashY = hashString(`${id}:y`);
  const xUnit = (hash % 10_000) / 10_000;
  const yUnit = (hashY % 10_000) / 10_000;
  return {
    x: (xUnit - 0.5) * 1800,
    y: (yUnit - 0.5) * 1050,
  };
};

const rankBubbleRadius = (baseRadius: number, index: number) => {
  const normalized = Math.max(0, Math.min(1, (safeNumber(baseRadius, 42) - 42) / 73));
  if (index < 5) return 90 + normalized * 35;
  if (index < 15) return 70 + normalized * 20;
  if (index < 35) return 50 + normalized * 20;
  return 38 + normalized * 17;
};

const clampPosition = (value: number, radius: number, max: number) => Math.max(radius, Math.min(max - radius, value));

const velocityForId = (id: string, axis: "x" | "y") => {
  const unit = (hashString(`${id}:velocity:${axis}`) % 10_000) / 10_000;
  return (unit - 0.5) * 0.3;
};

const collisionPaddingForViewport = (isMobile: boolean) => (isMobile ? MOBILE_COLLISION_PADDING : DESKTOP_COLLISION_PADDING);

const initialsForName = (name: string) => {
  const words = name
    .replace(/[^a-z0-9\s]/gi, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
};

const createBackgroundParticles = (): BackgroundParticle[] => {
  const colors = ["#38BDF8", "#22C55E", "#F59E0B", "#F43F5E", "#A78BFA"];
  return Array.from({ length: 130 }, (_, index) => {
    const hash = hashString(`particle-${index}`);
    const hashY = hashString(`particle-y-${index}`);
    return {
      x: (hash % 10_000) / 10_000,
      y: (hashY % 10_000) / 10_000,
      size: 0.7 + ((hash >> 8) % 18) / 10,
      alpha: 0.12 + ((hash >> 16) % 34) / 100,
      color: colors[index % colors.length],
    };
  });
};

const trendScoreForMarket = (market: TerminalMarket, volume: number) =>
  Math.abs(safeNumber(market.priceMove24h)) * 125 +
  Math.max(0, safeNumber(market.volumeAcceleration)) * 2 +
  Math.max(0, safeNumber(market.recentTradesCount)) / 8 +
  Math.log10(safePositiveNumber(volume) + 1);

export function getMarketOutcomes(market: RawOutcomeMarket): MarketOutcomeOption[] {
  const arrayOutcomes = parseStringArray(market.outcomes);
  const rawPrices = parseNumberArray(market.outcomePrices);
  const names = arrayOutcomes.length > 0 ? arrayOutcomes : [market.outcomes.yes, market.outcomes.no];
  const prices = rawPrices.length >= names.length ? rawPrices : [market.yesPrice, market.noPrice];
  const seen = new Set<string>();
  return names.map((name, index) => {
    const price = clamp01(prices[index]);
    let label = cleanOutcomeName(name, market.title);
    if (seen.has(label.toLowerCase())) {
      label = matchupOutcomeName(market.title, index) ?? `${label} ${index + 1}`;
    }
    seen.add(label.toLowerCase());
    return {
      name: label,
      price,
      priceCents: Math.round(price * 100),
    };
  });
}

export function getFavoredOutcome(market: RawOutcomeMarket) {
  const outcomes = getMarketOutcomes(market);
  return outcomes.reduce((best, current) => (current.price > best.price ? current : best), outcomes[0] ?? { name: "Market", price: 0, priceCents: 0 });
}

function marketColors(market: TerminalMarket, favoredOutcome: string) {
  const teamStyle = findTeamStyleMatch(`${favoredOutcome} ${market.title}`);
  if (teamStyle) {
    return {
      primary: teamStyle.primary,
      secondary: teamStyle.secondary,
      logoPath: teamStyle.logoPath,
      logoUrl: teamStyle.logoUrl,
    };
  }
  const priceMove = safeNumber(market.priceMove24h);
  if (priceMove > 0.005) return { primary: "#16C784", secondary: "#7CFFB2" };
  if (priceMove < -0.005) return { primary: "#EA3943", secondary: "#FF7A84" };
  return { primary: "#3A3F47", secondary: "#9AA4B2" };
}

export function marketToBubbleNode(market: TerminalMarket, index = 0): MarketBubbleNode {
  const volume = safePositiveNumber(market.volume, safePositiveNumber(market.volume24h));
  const liquidity = safePositiveNumber(market.liquidity);
  const priceChange = safeNumber(market.priceMove24h);
  const sizeBasis = Math.max(volume, liquidity);
  const favored = getFavoredOutcome(market);
  const outcomes = getMarketOutcomes(market);
  const style = marketColors(market, favored.name);
  const val = Math.max(8, rankBubbleRadius(marketBubbleRadius(sizeBasis), index));
  const trendScore = trendScoreForMarket(market, volume);
  const position = seededPosition(market.id);

  return {
    id: market.id,
    conditionId: market.conditionId,
    title: market.title,
    sport: market.league || market.sport,
    volume,
    liquidity,
    priceChange,
    marketUrl: `/markets/${market.id}`,
    polymarketUrl: market.slug ? `https://polymarket.com/event/${market.slug}` : undefined,
    tradeUrl: `/trade/${market.id}`,
    logoUrl: style.logoUrl ?? style.logoPath ?? market.image,
    logoPath: style.logoPath,
    primaryColor: style.primary,
    secondaryColor: style.secondary,
    glowColor: momentumGlowColor(priceChange, volume),
    favoredOutcome: compactOutcomeName(favored.name),
    favoredPrice: favored.price,
    priceCents: favored.priceCents,
    outcomes,
    bestBid: Number.isFinite(market.bestBid) ? market.bestBid : undefined,
    bestAsk: Number.isFinite(market.bestAsk) ? market.bestAsk : undefined,
    trendScore,
    isTrending: trendScore >= 10 || Math.abs(priceChange) >= 0.05 || safeNumber(market.recentTradesCount) >= 40 || safeNumber(market.volumeAcceleration) >= 1.5,
    driftPhase: (hashString(market.id) % 628) / 100,
    val,
    targetX: position.x,
    targetY: position.y,
    ...position,
  };
}

function hasBubbleOverlap(nodes: Array<{ x: number; y: number; val: number }>, padding = DESKTOP_COLLISION_PADDING) {
  return nodes.some((left, leftIndex) =>
    nodes.slice(leftIndex + 1).some((right) => Math.hypot(right.x - left.x, right.y - left.y) < left.val + right.val + padding - 0.01),
  );
}

export function layoutBubbleNodes(nodes: MarketBubbleNode[], width: number, height: number, isMobile = false, attempt = 0): MarketBubbleNode[] {
  const boardWidth = Math.max(320, safeNumber(width, 1200));
  const boardHeight = Math.max(420, safeNumber(height, 680));
  const footerReserve = isMobile ? 64 : 50;
  const topReserve = isMobile ? 14 : 10;
  const usableHeight = Math.max(320, boardHeight - footerReserve - topReserve);
  const collisionPadding = collisionPaddingForViewport(isMobile);
  const collisionGap = collisionPadding / 2;
  const totalArea = nodes.reduce((sum, node) => sum + Math.PI * Math.pow(safeRadius(node.val, 8) + collisionGap, 2), 0);
  const targetArea = boardWidth * usableHeight * (isMobile ? 0.62 : 0.76);
  const minimumScale = isMobile ? 0.22 : 0.5;
  const baseDensityScale = totalArea > 0 ? Math.min(1, Math.max(minimumScale, Math.sqrt(targetArea / totalArea))) : 1;
  const densityScale = Math.max(minimumScale, baseDensityScale * Math.pow(0.94, attempt));
  const anchors = isMobile
    ? [
        [0.5, 0.17],
        [0.28, 0.37],
        [0.72, 0.38],
        [0.36, 0.61],
        [0.68, 0.64],
      ]
    : [
        [0.16, 0.28],
        [0.5, 0.22],
        [0.84, 0.3],
        [0.32, 0.62],
        [0.68, 0.61],
      ];
  const remaining = Math.max(1, nodes.length - anchors.length);
  const columns = Math.max(3, Math.ceil(Math.sqrt(remaining * (boardWidth / usableHeight))));
  const rows = Math.max(2, Math.ceil(remaining / columns));

  const placed = nodes.map((node, index) => {
    const val = Math.max(8, safeRadius(node.val, 8) * densityScale);
    if (index < anchors.length) {
      const [xUnit, yUnit] = anchors[index];
      const x = clampPosition(boardWidth * xUnit, val, boardWidth);
      const y = clampPosition(topReserve + usableHeight * yUnit, val, boardHeight - footerReserve);
      return { ...node, val, x, y, targetX: x, targetY: y };
    }

    const gridIndex = index - anchors.length;
    const row = Math.floor(gridIndex / columns);
    const col = gridIndex % columns;
    const rowOffset = row % 2 === 0 ? 0.08 : 0.42;
    const jitterX = ((hashString(`${node.id}:layout-x`) % 1000) / 1000 - 0.5) * 0.26;
    const jitterY = ((hashString(`${node.id}:layout-y`) % 1000) / 1000 - 0.5) * 0.2;
    const xUnit = (col + 0.5 + rowOffset + jitterX) / columns;
    const yUnit = (row + 0.5 + jitterY) / rows;
    const x = clampPosition(boardWidth * xUnit, val, boardWidth);
    const y = clampPosition(topReserve + usableHeight * yUnit, val, boardHeight - footerReserve);
    return { ...node, val, x, y, targetX: x, targetY: y };
  });

  for (let iteration = 0; iteration < 240; iteration += 1) {
    let moved = false;
    for (let leftIndex = 0; leftIndex < placed.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < placed.length; rightIndex += 1) {
        const left = placed[leftIndex];
        const right = placed[rightIndex];
        const minDistance = left.val + right.val + collisionPadding;
        let dx = right.x - left.x;
        let dy = right.y - left.y;
        let distance = Math.hypot(dx, dy);
        if (distance >= minDistance) continue;
        if (distance < 0.001) {
          const angle = ((hashString(`${left.id}:${right.id}`) % 628) / 100);
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          distance = 1;
        }
        const push = (minDistance - distance) / 2;
        const nx = dx / distance;
        const ny = dy / distance;
        const leftWeight = right.val / (left.val + right.val);
        const rightWeight = left.val / (left.val + right.val);
        left.x = clampPosition(left.x - nx * push * leftWeight, left.val, boardWidth);
        left.y = clampPosition(left.y - ny * push * leftWeight, left.val, boardHeight - footerReserve);
        right.x = clampPosition(right.x + nx * push * rightWeight, right.val, boardWidth);
        right.y = clampPosition(right.y + ny * push * rightWeight, right.val, boardHeight - footerReserve);
        moved = true;
      }
    }
    if (!moved) break;
  }

  const packed = placed.map((node) => ({ ...node, targetX: node.x, targetY: node.y }));
  if (attempt < 12 && hasBubbleOverlap(packed, collisionPadding)) {
    return layoutBubbleNodes(nodes, width, height, isMobile, attempt + 1);
  }
  return packed;
}

export function createBubbleBodies(nodes: MarketBubbleNode[], width: number, height: number, isMobile = false): BubbleBody[] {
  return layoutBubbleNodes(nodes, width, height, isMobile).map((node) => {
    const radius = Math.max(8, safeRadius(node.val, 8));
    return {
      ...node,
      val: radius,
      radius,
      mass: radius * radius,
      vx: velocityForId(node.id, "x"),
      vy: velocityForId(node.id, "y"),
    };
  });
}

export function mergeBubbleBodies(previousBodies: BubbleBody[], nextBodies: BubbleBody[], width: number, height: number) {
  const previousById = new Map(previousBodies.map((body) => [body.id, body]));
  return nextBodies.map((nextBody) => {
    const previous = previousById.get(nextBody.id);
    if (!previous) return nextBody;
    const radius = Math.max(8, safeRadius(previous.radius, nextBody.radius));
    return {
      ...nextBody,
      x: clampPosition(previous.x, radius, width),
      y: clampPosition(previous.y, radius, height),
      targetX: previous.targetX,
      targetY: previous.targetY,
      radius,
      val: radius,
      mass: radius * radius,
      vx: safeNumber(previous.vx, nextBody.vx),
      vy: safeNumber(previous.vy, nextBody.vy),
    };
  });
}

function outcomePriceForName(outcomes: MarketOutcomeOption[], outcomeName: string, fallback: number) {
  return outcomes.find((outcome) => outcome.name === outcomeName)?.price ?? fallback;
}

function outcomeKeyForName(market: TerminalMarket, outcomeName: string) {
  if (market.outcomes.yes === outcomeName || outcomeName.toLowerCase() === "yes") return "yes";
  if (market.outcomes.no === outcomeName || outcomeName.toLowerCase() === "no") return "no";
  return null;
}

function liveOutcomeOptionsForSnapshot(outcomes: MarketOutcomeOption[], market: TerminalMarket) {
  return outcomes.map((outcome) => {
    const key = outcomeKeyForName(market, outcome.name);
    const price = key === "yes" ? market.yesPrice : key === "no" ? market.noPrice : outcome.price;
    return {
      ...outcome,
      price,
      priceCents: Math.round(clamp01(price) * 100),
    };
  });
}

function liveOutcomeOptionsForBody(body: BubbleBody, market: TerminalMarket) {
  return liveOutcomeOptionsForSnapshot(body.outcomes, market);
}

function livePriceForStableOutcome(body: BubbleBody, market: TerminalMarket) {
  return outcomePriceForName(liveOutcomeOptionsForBody(body, market), body.favoredOutcome, body.favoredPrice);
}

export function createBubbleVisualSmoothingState(body: Pick<BubbleBody, "favoredOutcome" | "favoredPrice">, now = Date.now()): BubbleVisualSmoothingState {
  return {
    displayedOutcome: body.favoredOutcome,
    pendingOutcome: null,
    pendingOutcomeSince: 0,
    priceFrom: body.favoredPrice,
    priceTarget: body.favoredPrice,
    priceStartedAt: now,
    priceDuration: PRICE_TWEEN_MS,
    lastVisualAppliedAt: 0,
    lastReceivedTimestamp: 0,
    lastSignature: "",
  };
}

function easeOutCubic(value: number) {
  return 1 - Math.pow(1 - value, 3);
}

export function advanceBubbleVisualTween(body: BubbleBody, state: BubbleVisualSmoothingState, now = Date.now()) {
  const elapsed = Math.max(0, now - state.priceStartedAt);
  const progress = Math.min(1, elapsed / Math.max(1, state.priceDuration));
  const eased = easeOutCubic(progress);
  body.favoredPrice = state.priceFrom + (state.priceTarget - state.priceFrom) * eased;
  body.priceCents = Math.round(clamp01(body.favoredPrice) * 100);
  if (body.visualPulseStartedAt && now - body.visualPulseStartedAt > PULSE_FADE_MS) {
    body.visualPulseStartedAt = undefined;
    body.visualPulseDirection = undefined;
  }
}

export function applySmoothedMarketValueToBody(
  body: BubbleBody,
  market: TerminalMarket,
  index: number,
  smoothingState: BubbleVisualSmoothingState,
  value?: MarketValueState,
  now = Date.now(),
) {
  void index;
  void smoothingState;
  void value;
  void now;
  body.activeRangeWarning = !hasUsefulFavoredPrice(market) || !isUsefulFavoredPrice(livePriceForStableOutcome(body, market));
  body.isLiveHidden = false;
  body.priceCents = Math.round(clamp01(body.favoredPrice) * 100);
  return false;
}

export function mergeStablePanelMarket(stable: MarketBubbleNode | null, liveMarket: TerminalMarket | null) {
  if (!stable) return null;
  if (!liveMarket) return stable;
  const liveOutcomes = liveOutcomeOptionsForSnapshot(stable.outcomes, liveMarket);
  const stableFavoredPrice = outcomePriceForName(liveOutcomes, stable.favoredOutcome, stable.favoredPrice);
  return {
    ...stable,
    volume: safePositiveNumber(liveMarket.volume, stable.volume),
    liquidity: safePositiveNumber(liveMarket.liquidity, stable.liquidity),
    priceChange: safeNumber(liveMarket.priceMove24h, stable.priceChange),
    favoredPrice: stableFavoredPrice,
    priceCents: Math.round(clamp01(stableFavoredPrice) * 100),
    outcomes: liveOutcomes,
    bestBid: liveMarket.bestBid ?? stable.bestBid,
    bestAsk: liveMarket.bestAsk ?? stable.bestAsk,
    activeRangeWarning: !hasUsefulFavoredPrice(liveMarket),
  } satisfies MarketBubbleNode;
}

async function readLatestMarketResponse(response: Response) {
  const payload = (await response.json().catch(() => null)) as { market?: TerminalMarket; error?: string } | null;
  if (!response.ok || !payload?.market) {
    throw new Error(payload?.error ?? "Unable to update selected market prices.");
  }
  return payload.market;
}

export async function fetchLatestMarketForNode(node: MarketBubbleNode) {
  const latest = await fetch(`/api/polymarket/markets/${encodeURIComponent(node.id)}`, { cache: "no-store" }).then(readLatestMarketResponse);
  return mergeStablePanelMarket(node, latest);
}

function clampBodyToBounds(body: BubbleBody, width: number, height: number) {
  const radius = Math.max(8, safeRadius(body.radius, 8));
  if (body.x - radius < 0) {
    body.x = radius;
    body.vx = Math.abs(body.vx) * WALL_BOUNCE;
  } else if (body.x + radius > width) {
    body.x = width - radius;
    body.vx = -Math.abs(body.vx) * WALL_BOUNCE;
  }
  if (body.y - radius < 0) {
    body.y = radius;
    body.vy = Math.abs(body.vy) * WALL_BOUNCE;
  } else if (body.y + radius > height) {
    body.y = height - radius;
    body.vy = -Math.abs(body.vy) * WALL_BOUNCE;
  }
}

function capVelocity(body: BubbleBody) {
  const speed = Math.hypot(body.vx, body.vy);
  if (speed <= MAX_BUBBLE_SPEED || speed <= 0) return;
  body.vx = (body.vx / speed) * MAX_BUBBLE_SPEED;
  body.vy = (body.vy / speed) * MAX_BUBBLE_SPEED;
}

function hasBodyOverlap(bodies: BubbleBody[], padding: number) {
  return bodies.some((left, leftIndex) =>
    bodies.slice(leftIndex + 1).some((right) => Math.hypot(right.x - left.x, right.y - left.y) < left.radius + right.radius + padding - 0.01),
  );
}

function resolveBubbleOverlaps(bodies: BubbleBody[], width: number, height: number, padding: number, passes = 3) {
  const boardWidth = Math.max(320, safeNumber(width, 1200));
  const boardHeight = Math.max(420, safeNumber(height, 680));
  for (let pass = 0; pass < passes; pass += 1) {
    for (let leftIndex = 0; leftIndex < bodies.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < bodies.length; rightIndex += 1) {
        const left = bodies[leftIndex];
        const right = bodies[rightIndex];
        const minDistance = left.radius + right.radius + padding;
        let dx = right.x - left.x;
        let dy = right.y - left.y;
        let distance = Math.hypot(dx, dy);
        if (distance >= minDistance) continue;
        if (distance < 0.001) {
          const angle = (hashString(`${left.id}:${right.id}:collision`) % 628) / 100;
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          distance = 1;
        }

        const nx = dx / distance;
        const ny = dy / distance;
        const overlap = minDistance - distance;
        const leftInverseMass = 1 / Math.max(1, left.mass);
        const rightInverseMass = 1 / Math.max(1, right.mass);
        const inverseMassSum = leftInverseMass + rightInverseMass;
        left.x -= nx * overlap * (leftInverseMass / inverseMassSum);
        left.y -= ny * overlap * (leftInverseMass / inverseMassSum);
        right.x += nx * overlap * (rightInverseMass / inverseMassSum);
        right.y += ny * overlap * (rightInverseMass / inverseMassSum);

        const relativeVelocityX = right.vx - left.vx;
        const relativeVelocityY = right.vy - left.vy;
        const velocityAlongNormal = relativeVelocityX * nx + relativeVelocityY * ny;
        if (velocityAlongNormal < 0) {
          const impulse = (-(1 + COLLISION_BOUNCE) * velocityAlongNormal) / inverseMassSum;
          left.vx -= impulse * leftInverseMass * nx;
          left.vy -= impulse * leftInverseMass * ny;
          right.vx += impulse * rightInverseMass * nx;
          right.vy += impulse * rightInverseMass * ny;
          capVelocity(left);
          capVelocity(right);
        }

        clampBodyToBounds(left, boardWidth, boardHeight);
        clampBodyToBounds(right, boardWidth, boardHeight);
      }
    }
  }
}

function assertNoBubbleOverlapInDevelopment(bodies: BubbleBody[], padding: number) {
  if (process.env.NODE_ENV === "production" || !hasBodyOverlap(bodies, padding)) return;
  console.warn("Traak bubble overlap detected after physics resolution.", { padding, count: bodies.length });
}

export function tickBubblePhysics(bodies: BubbleBody[], width: number, height: number, delta = 1, isMobile = false) {
  const boardWidth = Math.max(320, safeNumber(width, 1200));
  const boardHeight = Math.max(420, safeNumber(height, 680));
  const step = Math.max(0.25, Math.min(2, safeNumber(delta, 1)));
  const collisionPadding = collisionPaddingForViewport(isMobile);

  for (const body of bodies) {
    const phase = safeNumber(body.driftPhase);
    body.vx += Math.sin(Date.now() / 7000 + phase) * 0.002 * step;
    body.vy += Math.cos(Date.now() / 7600 + phase) * 0.002 * step;
    body.vx *= VELOCITY_DAMPING;
    body.vy *= VELOCITY_DAMPING;
    capVelocity(body);
    body.x += body.vx * step;
    body.y += body.vy * step;
    clampBodyToBounds(body, boardWidth, boardHeight);
  }

  resolveBubbleOverlaps(bodies, boardWidth, boardHeight, collisionPadding);
}

function resolveOverlapsBeforeDraw(bodies: BubbleBody[], width: number, height: number, isMobile: boolean) {
  const padding = collisionPaddingForViewport(isMobile);
  if (hasBodyOverlap(bodies, padding)) {
    resolveBubbleOverlaps(bodies, width, height, padding, 8);
  }
  assertNoBubbleOverlapInDevelopment(bodies, padding);
}

function drawFieldLines(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  color: string,
  alpha: number,
  variant: "soccer" | "basketball" | "football" | "tennis" | "ufc",
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2;
  if (variant === "soccer") {
    ctx.strokeRect(width * 0.12, height * 0.13, width * 0.76, height * 0.68);
    ctx.beginPath();
    ctx.moveTo(width * 0.5, height * 0.13);
    ctx.lineTo(width * 0.5, height * 0.81);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(width * 0.5, height * 0.47, Math.min(width, height) * 0.13, 0, Math.PI * 2);
    ctx.stroke();
  } else if (variant === "basketball") {
    ctx.beginPath();
    ctx.arc(width * 0.5, height * 0.5, Math.min(width, height) * 0.26, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(width * 0.5, height * 0.5, Math.min(width, height) * 0.58, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(width * 0.5, height * 0.5, Math.min(width, height) * 0.58, Math.PI / 2, Math.PI * 1.5);
    ctx.stroke();
  } else if (variant === "football") {
    const left = width * 0.12;
    const right = width * 0.88;
    for (let y = height * 0.14; y < height * 0.86; y += height * 0.14) {
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(width * 0.22, height * 0.5);
    ctx.lineTo(width * 0.78, height * 0.5);
    ctx.stroke();
  } else if (variant === "tennis") {
    ctx.strokeRect(width * 0.16, height * 0.2, width * 0.68, height * 0.56);
    ctx.beginPath();
    ctx.moveTo(width * 0.5, height * 0.2);
    ctx.lineTo(width * 0.5, height * 0.76);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(width * 0.16, height * 0.5);
    ctx.lineTo(width * 0.84, height * 0.5);
    ctx.stroke();
  } else if (variant === "ufc") {
    const cx = width * 0.5;
    const cy = height * 0.5;
    const r = Math.min(width, height) * 0.24;
    ctx.beginPath();
    for (let index = 0; index < 8; index += 1) {
      const angle = Math.PI / 8 + (index * Math.PI * 2) / 8;
      const px = cx + Math.cos(angle) * r;
      const py = cy + Math.sin(angle) * r;
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
  }
  ctx.restore();
}

function backgroundThemeForSport(sport?: string): BackgroundTheme {
  const value = (sport ?? "").toLowerCase();
  if (value === "all" || value === "") return "neutral";
  if (value.includes("soccer") || value.includes("epl") || value.includes("uefa") || value.includes("champions")) return "soccer";
  if (value.includes("nba") || value.includes("basketball")) return "basketball";
  if (value.includes("nfl") || value.includes("football")) return "football";
  if (value.includes("tennis")) return "tennis";
  if (value.includes("ufc") || value.includes("mma")) return "ufc";
  return "neutral";
}

function drawBackgroundTheme(
  ctx: CanvasRenderingContext2D,
  theme: BackgroundTheme,
  width: number,
  height: number,
  alpha = 1,
  pixelRatio = 1,
  particles: BackgroundParticle[] = [],
) {
  ctx.save();
  ctx.globalAlpha = alpha;

  const drawStadiumLights = (intensity: number) => {
    const blooms = [
      { x: width * 0.16, y: height * 0.12, r: Math.max(width, height) * 0.42 },
      { x: width * 0.84, y: height * 0.11, r: Math.max(width, height) * 0.38 },
      { x: width * 0.5, y: height * 0.05, r: Math.max(width, height) * 0.52 },
    ];
    for (const bloom of blooms) {
      const grad = ctx.createRadialGradient(bloom.x, bloom.y, bloom.r * 0.06, bloom.x, bloom.y, bloom.r);
      grad.addColorStop(0, `rgba(255,255,255,${0.11 * intensity})`);
      grad.addColorStop(0.3, `rgba(148,163,184,${0.04 * intensity})`);
      grad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(bloom.x, bloom.y, bloom.r, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  const drawCrowdSilhouette = (baseY: number, opacityValue: number) => {
    ctx.fillStyle = `rgba(15,23,42,${opacityValue})`;
    ctx.beginPath();
    ctx.moveTo(0, baseY);
    const segments = 16;
    for (let index = 0; index <= segments; index += 1) {
      const px = (width / segments) * index;
      const wave = Math.sin(index * 0.9) * height * 0.01 + Math.cos(index * 0.45) * height * 0.006;
      const py = baseY + wave;
      ctx.lineTo(px, py);
    }
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.fill();
  };

  if (theme === "soccer") {
    ctx.fillStyle = "#050b07";
    ctx.fillRect(0, 0, width, height);
    drawStadiumLights(1);
    drawCrowdSilhouette(height * 0.16, 0.18);
    drawCrowdSilhouette(height * 0.22, 0.12);
    ctx.fillStyle = "rgba(16,64,42,0.18)";
    ctx.fillRect(0, height * 0.26, width, height * 0.5);
    const pitch = ctx.createRadialGradient(width * 0.5, height * 0.46, Math.min(width, height) * 0.1, width * 0.5, height * 0.5, Math.max(width, height) * 0.82);
    pitch.addColorStop(0, "rgba(34,197,94,0.05)");
    pitch.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = pitch;
    ctx.fillRect(0, 0, width, height);
    drawFieldLines(ctx, width, height, "rgba(186,255,200,0.08)", 0.06, "soccer");
  } else if (theme === "basketball") {
    ctx.fillStyle = "#090603";
    ctx.fillRect(0, 0, width, height);
    drawStadiumLights(0.85);
    drawCrowdSilhouette(height * 0.18, 0.16);
    ctx.fillStyle = "rgba(86,47,19,0.18)";
    ctx.fillRect(0, height * 0.28, width, height * 0.46);
    const courtGlow = ctx.createRadialGradient(width * 0.5, height * 0.55, Math.min(width, height) * 0.1, width * 0.5, height * 0.55, Math.max(width, height) * 0.82);
    courtGlow.addColorStop(0, "rgba(245,158,11,0.055)");
    courtGlow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = courtGlow;
    ctx.fillRect(0, 0, width, height);
    drawFieldLines(ctx, width, height, "rgba(245,158,11,0.07)", 0.05, "basketball");
  } else if (theme === "football") {
    ctx.fillStyle = "#050a06";
    ctx.fillRect(0, 0, width, height);
    drawStadiumLights(0.92);
    drawCrowdSilhouette(height * 0.17, 0.16);
    ctx.fillStyle = "rgba(19,86,45,0.16)";
    ctx.fillRect(0, height * 0.3, width, height * 0.42);
    const turfGlow = ctx.createRadialGradient(width * 0.5, height * 0.56, Math.min(width, height) * 0.1, width * 0.5, height * 0.56, Math.max(width, height) * 0.8);
    turfGlow.addColorStop(0, "rgba(34,197,94,0.04)");
    turfGlow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = turfGlow;
    ctx.fillRect(0, 0, width, height);
    drawFieldLines(ctx, width, height, "rgba(236,253,245,0.07)", 0.06, "football");
  } else if (theme === "tennis") {
    ctx.fillStyle = "#050a09";
    ctx.fillRect(0, 0, width, height);
    drawStadiumLights(0.78);
    drawCrowdSilhouette(height * 0.16, 0.14);
    ctx.fillStyle = "rgba(21,77,50,0.16)";
    ctx.fillRect(0, height * 0.28, width, height * 0.46);
    const courtGlow = ctx.createRadialGradient(width * 0.5, height * 0.52, Math.min(width, height) * 0.08, width * 0.5, height * 0.52, Math.max(width, height) * 0.78);
    courtGlow.addColorStop(0, "rgba(187,247,208,0.035)");
    courtGlow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = courtGlow;
    ctx.fillRect(0, 0, width, height);
    drawFieldLines(ctx, width, height, "rgba(187,247,208,0.08)", 0.06, "tennis");
  } else if (theme === "ufc") {
    ctx.fillStyle = "#040404";
    ctx.fillRect(0, 0, width, height);
    drawStadiumLights(0.7);
    drawCrowdSilhouette(height * 0.15, 0.15);
    const cageGlow = ctx.createRadialGradient(width * 0.5, height * 0.5, Math.min(width, height) * 0.08, width * 0.5, height * 0.5, Math.max(width, height) * 0.78);
    cageGlow.addColorStop(0, "rgba(255,255,255,0.025)");
    cageGlow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = cageGlow;
    ctx.fillRect(0, 0, width, height);
    drawFieldLines(ctx, width, height, "rgba(255,255,255,0.07)", 0.06, "ufc");
  } else {
    ctx.fillStyle = "#050505";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "rgba(31,41,55,0.24)";
    ctx.fillRect(0, 0, width, height);
  }

  const sweepPhase = (Date.now() % 12000) / 12000;
  const sweepX = width * (0.1 + sweepPhase * 0.8);
  const sweepY = height * (0.16 + Math.sin(sweepPhase * Math.PI * 2) * 0.03);
  const sweep = ctx.createRadialGradient(sweepX, sweepY, Math.max(width, height) * 0.02, sweepX, sweepY, Math.max(width, height) * 0.42);
  sweep.addColorStop(0, "rgba(255,255,255,0.06)");
  sweep.addColorStop(0.16, "rgba(148,163,184,0.03)");
  sweep.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = sweep;
  ctx.fillRect(0, 0, width, height);

  const particleLimit = Math.min(particles.length, pixelRatio > 1.5 ? 70 : 88);
  for (const particle of particles.slice(0, particleLimit)) {
    ctx.globalAlpha = particle.alpha * alpha * (theme === "neutral" ? 1 : 0.68);
    ctx.fillStyle = particle.color;
    ctx.shadowColor = particle.color;
    ctx.shadowBlur = particle.size * 3;
    ctx.beginPath();
    ctx.arc(safeCoordinate(particle.x * width), safeCoordinate(particle.y * height), safeRadius(particle.size), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
  ctx.restore();
}

function drawTextLine(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number) {
  ctx.strokeStyle = "rgba(2, 6, 23, 0.78)";
  ctx.lineWidth = 3;
  ctx.strokeText(text, x, y, maxWidth);
  ctx.fillText(text, x, y, maxWidth);
}

function drawLogoMark(node: MarketBubbleNode, ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, opacity: number) {
  const logo = getLogoAsset(node.logoUrl);
  const safeBubbleRadius = safeRadius(radius, 8);
  const logoSize = safeRadius(Math.min(safeBubbleRadius * 0.34, safeBubbleRadius * 0.3 + safeBubbleRadius * 0.015), 4);
  const logoX = safeCoordinate(x);
  const logoY = safeCoordinate(y);

  ctx.save();
  ctx.globalAlpha *= Math.max(0.88, Math.min(0.93, opacity));
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const bitmap = logo?.bitmap;
  const image = logo?.image;
  const drawable = bitmap ?? (image?.complete && image.naturalWidth > 0 ? image : null);
  if (drawable) {
    ctx.fillStyle = "rgba(2, 6, 23, 0.18)";
    ctx.beginPath();
    ctx.arc(logoX, logoY, safeRadius(logoSize * 0.58), 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(logoX, logoY, safeRadius(logoSize / 2), 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(drawable, logoX - logoSize / 2, logoY - logoSize / 2, logoSize, logoSize);
  } else {
    const initials = initialsForName(node.favoredOutcome);
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = Math.max(1.2, safeBubbleRadius * 0.02);
    ctx.beginPath();
    ctx.arc(logoX, logoY, safeRadius(logoSize * 0.42), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (initials) {
      ctx.fillStyle = "rgba(255,255,255,0.78)";
      ctx.font = `900 ${Math.max(9, safeBubbleRadius * 0.14)}px Inter, ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(initials, logoX, logoY + 0.5, logoSize * 0.7);
    }
  }
  ctx.restore();
}

type SportBubbleKind = "soccer" | "basketball" | "football" | "tennis" | "baseball" | "hockey" | "ufc" | "f1" | "fallback";

function sportBubbleKind(node: MarketBubbleNode): SportBubbleKind {
  const value = `${node.sport} ${node.title}`.toLowerCase();
  if (/\b(soccer|premier league|champions league|laliga|serie a|bundesliga|mls|epl|uefa|fifa)\b/.test(value)) return "soccer";
  if (/\b(nba|wnba|basketball|ncaa)\b/.test(value)) return "basketball";
  if (/\b(nfl|football|chiefs|eagles|cowboys|49ers|packers)\b/.test(value)) return "football";
  if (/\b(tennis|atp|wta|wimbledon|us open|french open|australian open)\b/.test(value)) return "tennis";
  if (/\b(mlb|baseball|dodgers|yankees|red sox)\b/.test(value)) return "baseball";
  if (/\b(nhl|hockey|stanley cup)\b/.test(value)) return "hockey";
  if (/\b(ufc|mma|fight|boxing)\b/.test(value)) return "ufc";
  if (/\b(f1|formula 1|racing|grand prix|nascar)\b/.test(value)) return "f1";
  return "fallback";
}

type SoccerBallVariant = {
  layout: number;
  baseColor: string;
  panelColor: string;
  seamColor: string;
  seamSoftColor: string;
  highlightColor: string;
  grainColor: string;
  grainScale: number;
  seamWidth: number;
  highlightX: number;
  highlightY: number;
};

type BasketballVariant = {
  baseColor: string;
  channelColor: string;
  grainColor: string;
  highlightColor: string;
  seamWidth: number;
  grainScale: number;
  shadowAlpha: number;
  highlightX: number;
  highlightY: number;
};

type BaseballVariant = {
  leatherColor: string;
  seamColor: string;
  stitchColor: string;
  seamAngle: number;
  stitchSpacing: number;
  grainColor: string;
  grainScale: number;
  highlightColor: string;
};

type TennisVariant = {
  baseColor: string;
  seamColor: string;
  seamSoftColor: string;
  grainColor: string;
  grainScale: number;
  highlightColor: string;
  seamCurve: number;
};

type FootballVariant = {
  baseColor: string;
  panelColor: string;
  laceColor: string;
  stitchColor: string;
  grainColor: string;
  grainScale: number;
  seamWidth: number;
  laceWidth: number;
  seamAngle: number;
  highlightColor: string;
};

function hashVariant(node: MarketBubbleNode, salt: string, count: number) {
  return count <= 0 ? 0 : hashString(`${node.id}:${salt}`) % count;
}

function soccerBallVariant(node: MarketBubbleNode): SoccerBallVariant {
  const layout = hashVariant(node, "soccer-layout", 4);
  const palette = hashVariant(node, "soccer-palette", 4);
  const light = hashVariant(node, "soccer-light", 6);
  const palettes = [
    { baseColor: "#f8f6ef", panelColor: "#27313a", seamColor: "rgba(52,61,72,0.26)", seamSoftColor: "rgba(255,255,255,0.18)", highlightColor: "rgba(255,255,255,0.28)", grainColor: "rgba(31,41,55,0.12)" },
    { baseColor: "#fbf8f1", panelColor: "#202a34", seamColor: "rgba(38,47,58,0.24)", seamSoftColor: "rgba(255,255,255,0.15)", highlightColor: "rgba(255,255,255,0.26)", grainColor: "rgba(31,41,55,0.1)" },
    { baseColor: "#f2f5f7", panelColor: "#313942", seamColor: "rgba(49,57,66,0.22)", seamSoftColor: "rgba(255,255,255,0.18)", highlightColor: "rgba(255,255,255,0.24)", grainColor: "rgba(31,41,55,0.1)" },
    { baseColor: "#ece7db", panelColor: "#26313d", seamColor: "rgba(53,61,71,0.22)", seamSoftColor: "rgba(255,255,255,0.16)", highlightColor: "rgba(255,255,255,0.22)", grainColor: "rgba(31,41,55,0.1)" },
  ] as const;
  return {
    layout,
    ...palettes[palette],
    grainScale: 0.45 + light * 0.14,
    seamWidth: 0.8 + ((light + palette) % 3) * 0.14,
    highlightX: -0.28 + (light % 3) * 0.12,
    highlightY: -0.34 + ((palette + light) % 3) * 0.08,
  };
}

function basketballVariant(node: MarketBubbleNode): BasketballVariant {
  const palette = hashVariant(node, "basketball-palette", 4);
  const variants = [
    { baseColor: "#f79c4b", channelColor: "#3a2013", grainColor: "rgba(112,53,18,0.26)", highlightColor: "rgba(255,240,220,0.24)", seamWidth: 0.048, grainScale: 1.25, shadowAlpha: 0.18, highlightX: -0.28, highlightY: -0.34 },
    { baseColor: "#e98d3e", channelColor: "#331b11", grainColor: "rgba(102,46,16,0.24)", highlightColor: "rgba(255,231,202,0.2)", seamWidth: 0.044, grainScale: 1.1, shadowAlpha: 0.18, highlightX: -0.22, highlightY: -0.3 },
    { baseColor: "#d97f31", channelColor: "#2f190f", grainColor: "rgba(88,40,14,0.24)", highlightColor: "rgba(255,236,216,0.18)", seamWidth: 0.05, grainScale: 1.32, shadowAlpha: 0.2, highlightX: -0.18, highlightY: -0.26 },
    { baseColor: "#cb742c", channelColor: "#342014", grainColor: "rgba(82,38,14,0.22)", highlightColor: "rgba(255,224,164,0.18)", seamWidth: 0.047, grainScale: 1.08, shadowAlpha: 0.2, highlightX: -0.26, highlightY: -0.34 },
  ] as const;
  return variants[palette];
}

function baseballVariant(node: MarketBubbleNode): BaseballVariant {
  const palette = hashVariant(node, "baseball-palette", 3);
  const angle = hashVariant(node, "baseball-angle", 5);
  const spacing = hashVariant(node, "baseball-spacing", 4);
  const variants = [
    { leatherColor: "#fbf8f1", seamColor: "#9f1d23", stitchColor: "#c21f27", seamAngle: -0.02, stitchSpacing: 0.13, grainColor: "rgba(90,70,50,0.12)", grainScale: 0.8, highlightColor: "rgba(255,255,255,0.24)" },
    { leatherColor: "#f8f4ea", seamColor: "#a31c24", stitchColor: "#bf2229", seamAngle: -0.08, stitchSpacing: 0.12, grainColor: "rgba(90,70,50,0.1)", grainScale: 0.72, highlightColor: "rgba(255,255,255,0.22)" },
    { leatherColor: "#f3efe2", seamColor: "#921a22", stitchColor: "#ae1f27", seamAngle: 0.06, stitchSpacing: 0.11, grainColor: "rgba(90,70,50,0.1)", grainScale: 0.76, highlightColor: "rgba(255,255,255,0.2)" },
  ] as const;
  const selected = variants[palette];
  return {
    ...selected,
    seamAngle: selected.seamAngle + (angle - 2) * 0.022,
    stitchSpacing: selected.stitchSpacing + (spacing - 1) * 0.006,
  };
}

function tennisVariant(node: MarketBubbleNode): TennisVariant {
  const palette = hashVariant(node, "tennis-palette", 3);
  const curve = hashVariant(node, "tennis-curve", 5);
  const variants = [
    { baseColor: "#e9ef91", seamColor: "rgba(247,250,212,0.96)", seamSoftColor: "rgba(87,103,32,0.16)", grainColor: "rgba(255,255,255,0.3)", grainScale: 1.5, highlightColor: "rgba(255,255,255,0.2)", seamCurve: -0.15 },
    { baseColor: "#dce84d", seamColor: "rgba(247,250,180,0.96)", seamSoftColor: "rgba(96,116,25,0.16)", grainColor: "rgba(255,255,255,0.28)", grainScale: 1.58, highlightColor: "rgba(255,255,255,0.18)", seamCurve: -0.08 },
    { baseColor: "#cfe33f", seamColor: "rgba(239,244,180,0.96)", seamSoftColor: "rgba(72,93,21,0.18)", grainColor: "rgba(255,255,255,0.26)", grainScale: 1.42, highlightColor: "rgba(255,255,255,0.16)", seamCurve: -0.22 },
  ] as const;
  const selected = variants[palette];
  return {
    ...selected,
    seamCurve: selected.seamCurve + (curve - 2) * 0.014,
  };
}

function footballVariant(node: MarketBubbleNode): FootballVariant {
  const palette = hashVariant(node, "football-palette", 4);
  const lace = hashVariant(node, "football-lace", 4);
  const seam = hashVariant(node, "football-seam", 4);
  const variants = [
    { baseColor: "#98592f", panelColor: "#6b341a", laceColor: "#f6e6c4", stitchColor: "rgba(250,235,198,0.72)", grainColor: "rgba(15,8,5,0.24)", grainScale: 1.2, seamWidth: 0.035, laceWidth: 0.055, seamAngle: -0.18, highlightColor: "rgba(255,242,208,0.16)" },
    { baseColor: "#8f4f2a", panelColor: "#612e17", laceColor: "#f0dec0", stitchColor: "rgba(247,231,196,0.7)", grainColor: "rgba(18,10,6,0.22)", grainScale: 1.08, seamWidth: 0.033, laceWidth: 0.05, seamAngle: -0.12, highlightColor: "rgba(255,238,194,0.14)" },
    { baseColor: "#7d4525", panelColor: "#54301a", laceColor: "#f8ecd6", stitchColor: "rgba(252,238,205,0.72)", grainColor: "rgba(12,8,5,0.24)", grainScale: 1.26, seamWidth: 0.038, laceWidth: 0.06, seamAngle: -0.2, highlightColor: "rgba(255,240,215,0.16)" },
    { baseColor: "#733d1f", panelColor: "#4a2312", laceColor: "#ead7b5", stitchColor: "rgba(238,221,186,0.66)", grainColor: "rgba(14,8,5,0.22)", grainScale: 1.1, seamWidth: 0.032, laceWidth: 0.045, seamAngle: -0.16, highlightColor: "rgba(255,230,182,0.12)" },
  ] as const;
  const selected = variants[palette];
  return {
    ...selected,
    laceWidth: selected.laceWidth + (lace - 1.5) * 0.006,
    seamAngle: selected.seamAngle + (seam - 1.5) * 0.03,
  };
}

function soccerPanelLayout(x: number, y: number, radius: number, variant: SoccerBallVariant) {
  const offset = variant.layout;
  if (offset === 1) {
    return [
      starPoints(x, y - radius * 0.02, radius * 0.33, radius * 0.13, -Math.PI / 2.08),
      starPoints(x - radius * 0.45, y - radius * 0.26, radius * 0.26, radius * 0.1, -Math.PI / 2.7),
      starPoints(x + radius * 0.47, y - radius * 0.22, radius * 0.26, radius * 0.1, -Math.PI / 1.55),
      starPoints(x - radius * 0.33, y + radius * 0.44, radius * 0.2, radius * 0.08, -Math.PI / 2.85),
      starPoints(x + radius * 0.38, y + radius * 0.49, radius * 0.22, radius * 0.09, -Math.PI / 1.86),
      starPoints(x, y + radius * 0.08, radius * 0.14, radius * 0.045, -Math.PI / 2),
    ];
  }
  if (offset === 2) {
    return [
      starPoints(x, y - radius * 0.03, radius * 0.34, radius * 0.12, -Math.PI / 2.02),
      starPoints(x - radius * 0.53, y - radius * 0.18, radius * 0.23, radius * 0.09, -Math.PI / 2.8),
      starPoints(x + radius * 0.53, y - radius * 0.18, radius * 0.23, radius * 0.09, -Math.PI / 1.5),
      starPoints(x - radius * 0.43, y + radius * 0.44, radius * 0.2, radius * 0.08, -Math.PI / 3.2),
      starPoints(x + radius * 0.43, y + radius * 0.44, radius * 0.2, radius * 0.08, -Math.PI / 1.8),
    ];
  }
  if (offset === 3) {
    return [
      starPoints(x, y - radius * 0.02, radius * 0.3, radius * 0.12, -Math.PI / 2),
      starPoints(x - radius * 0.5, y - radius * 0.28, radius * 0.24, radius * 0.1, -Math.PI / 2.35),
      starPoints(x + radius * 0.5, y - radius * 0.28, radius * 0.24, radius * 0.1, -Math.PI / 1.7),
      starPoints(x - radius * 0.38, y + radius * 0.48, radius * 0.22, radius * 0.09, -Math.PI / 2.95),
      starPoints(x + radius * 0.38, y + radius * 0.48, radius * 0.22, radius * 0.09, -Math.PI / 1.9),
    ];
  }
  return [
    starPoints(x, y - radius * 0.02, radius * 0.31, radius * 0.14, -Math.PI / 2),
    starPoints(x - radius * 0.52, y - radius * 0.28, radius * 0.24, radius * 0.1, -Math.PI / 2.5),
    starPoints(x + radius * 0.52, y - radius * 0.28, radius * 0.24, radius * 0.1, -Math.PI / 1.7),
    starPoints(x - radius * 0.38, y + radius * 0.5, radius * 0.22, radius * 0.09, -Math.PI / 3),
    starPoints(x + radius * 0.38, y + radius * 0.5, radius * 0.22, radius * 0.09, -Math.PI / 1.9),
  ];
}

function clipCircle(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number) {
  ctx.beginPath();
  ctx.arc(x, y, safeRadius(radius), 0, Math.PI * 2);
  ctx.clip();
}

function drawBallGloss(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number) {
  const gloss = ctx.createRadialGradient(x - radius * 0.34, y - radius * 0.38, radius * 0.08, x, y, radius);
  gloss.addColorStop(0, "rgba(255,255,255,0.24)");
  gloss.addColorStop(0.34, "rgba(255,255,255,0.06)");
  gloss.addColorStop(0.76, "rgba(255,255,255,0)");
  gloss.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gloss;
  ctx.beginPath();
  ctx.arc(x, y, safeRadius(radius), 0, Math.PI * 2);
  ctx.fill();
}

function drawMatteLighting(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, shadowAlpha = 0.34, highlightAlpha = 0.2) {
  const edge = ctx.createRadialGradient(x - radius * 0.22, y - radius * 0.24, radius * 0.18, x, y, radius);
  edge.addColorStop(0, `rgba(255,255,255,${highlightAlpha})`);
  edge.addColorStop(0.56, "rgba(255,255,255,0.01)");
  edge.addColorStop(0.82, "rgba(255,255,255,0)");
  edge.addColorStop(1, `rgba(255,255,255,${Math.max(0.02, shadowAlpha * 0.16)})`);
  ctx.fillStyle = edge;
  ctx.beginPath();
  ctx.arc(x, y, safeRadius(radius), 0, Math.PI * 2);
  ctx.fill();
}

function drawBallGrain(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string, countMultiplier = 1) {
  const count = Math.max(10, Math.floor(radius * 0.8 * countMultiplier));
  ctx.save();
  ctx.globalAlpha *= 0.32;
  ctx.fillStyle = color;
  for (let index = 0; index < count; index += 1) {
    const hash = hashString(`${Math.round(x)}:${Math.round(y)}:${Math.round(radius)}:${index}`);
    const angle = (hash % 6283) / 1000;
    const distance = Math.sqrt(((hash >> 8) % 1000) / 1000) * radius * 0.9;
    const dotRadius = 0.45 + ((hash >> 18) % 12) / 20;
    ctx.beginPath();
    ctx.arc(x + Math.cos(angle) * distance, y + Math.sin(angle) * distance, safeRadius(dotRadius), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawPolygon(ctx: CanvasRenderingContext2D, points: Array<[number, number]>) {
  ctx.beginPath();
  points.forEach(([px, py], index) => {
    if (index === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.closePath();
}

function starPoints(x: number, y: number, outerRadius: number, innerRadius: number, rotation = -Math.PI / 2) {
  return Array.from({ length: 10 }, (_, index) => {
    const pointRadius = index % 2 === 0 ? outerRadius : innerRadius;
    const angle = rotation + (index * Math.PI) / 5;
    return [x + Math.cos(angle) * pointRadius, y + Math.sin(angle) * pointRadius] as [number, number];
  });
}

function drawLabelPlate(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number) {
  const plateWidth = radius * 1.34;
  const plateHeight = radius * 0.68;
  const plateY = y + radius * 0.1;
  ctx.save();
  ctx.fillStyle = "rgba(2, 6, 23, 0.28)";
  ctx.beginPath();
  ctx.ellipse(x, plateY, plateWidth / 2, plateHeight / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = Math.max(1, radius * 0.014);
  ctx.stroke();
  ctx.restore();
}

function drawClippedImageAsset(
  ctx: CanvasRenderingContext2D,
  src: string,
  x: number,
  y: number,
  radius: number,
  rotation = 0,
  opacity = 1,
) {
  const asset = getImageAsset(src);
  const drawable = asset?.bitmap ?? (asset?.image.complete && asset.image.naturalWidth > 0 ? asset.image : null);
  if (!drawable) return false;
  ctx.save();
  ctx.globalAlpha *= opacity;
  ctx.translate(x, y);
  if (rotation !== 0) ctx.rotate(rotation);
  ctx.beginPath();
  ctx.arc(0, 0, safeRadius(radius), 0, Math.PI * 2);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const coverSize = radius * 2.08;
  const offsetX = -coverSize / 2;
  const offsetY = -coverSize / 2 - radius * 0.055;
  ctx.drawImage(drawable, offsetX, offsetY, coverSize, coverSize);
  ctx.restore();
  return true;
}

function drawFallbackGlassBubble(ctx: CanvasRenderingContext2D, node: MarketBubbleNode, x: number, y: number, radius: number) {
  const fill = ctx.createRadialGradient(x - radius * 0.25, y - radius * 0.34, safeRadius(radius * 0.12), x, y, radius);
  fill.addColorStop(0, `${node.primaryColor}66`);
  fill.addColorStop(0.48, "#18181b");
  fill.addColorStop(1, "#030303");
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(x, y, safeRadius(radius), 0, Math.PI * 2);
  ctx.fill();
}

const SOCCER_ASSETS = [
  "/sport-balls/soccer-white-black.png",
  "/sport-balls/soccer-red.png",
  "/sport-balls/soccer-blue.png",
  "/sport-balls/soccer-yellow.png",
];

function soccerAssetForNode(node: MarketBubbleNode) {
  return SOCCER_ASSETS[hashVariant(node, "soccer-asset", SOCCER_ASSETS.length)];
}

function sportAssetForNode(node: MarketBubbleNode) {
  const kind = sportBubbleKind(node);
  if (kind === "soccer") return soccerAssetForNode(node);
  if (kind === "basketball") return ["/sport-balls/basketball.png", "/sport-balls/basketball-alt.png"][hashVariant(node, "basketball-asset", 2)];
  if (kind === "football") return ["/sport-balls/football.png", "/sport-balls/football-alt.png"][hashVariant(node, "football-asset", 2)];
  if (kind === "tennis") return ["/sport-balls/tennis-green.png", "/sport-balls/tennis-pink.png"][hashVariant(node, "tennis-asset", 2)];
  if (kind === "ufc") return ["/sport-balls/ufc-glove-red.png", "/sport-balls/ufc-glove-black.png"][hashVariant(node, "ufc-asset", 2)];
  if (kind === "baseball") return "/sport-balls/baseball.png";
  return null;
}

function drawSoccerBall(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, variant: SoccerBallVariant) {
  ctx.save();
  clipCircle(ctx, x, y, radius);
  const body = ctx.createRadialGradient(x + radius * variant.highlightX, y + radius * variant.highlightY, radius * 0.08, x, y, radius);
  body.addColorStop(0, variant.baseColor);
  body.addColorStop(0.6, variant.baseColor);
  body.addColorStop(1, "#eef0ea");
  ctx.fillStyle = body;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);

  ctx.strokeStyle = variant.seamColor;
  ctx.lineWidth = Math.max(1, radius * variant.seamWidth);
  const seamCount = variant.layout === 1 ? 7 : variant.layout === 2 ? 6 : 5;
  for (let index = 0; index < seamCount; index += 1) {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / seamCount;
    ctx.beginPath();
    ctx.ellipse(
      x + Math.cos(angle) * radius * 0.15,
      y + Math.sin(angle) * radius * 0.12,
      radius * (variant.layout === 2 ? 0.96 : 0.92),
      radius * (variant.layout === 1 ? 0.2 : 0.22),
      angle + Math.PI / 2,
      -Math.PI * 0.38,
      Math.PI * 0.38,
    );
    ctx.stroke();
  }

  const panels = soccerPanelLayout(x, y, radius, variant);

  for (const points of panels) {
    drawPolygon(ctx, points);
    ctx.fillStyle = variant.seamSoftColor;
    ctx.save();
    ctx.translate(radius * 0.018, radius * 0.022);
    ctx.fill();
    ctx.restore();
    drawPolygon(ctx, points);
    ctx.fillStyle = variant.panelColor;
    ctx.fill();
    ctx.strokeStyle = variant.seamColor;
    ctx.lineWidth = Math.max(0.8, radius * variant.seamWidth);
    ctx.stroke();
  }
  drawBallGrain(ctx, x, y, radius, variant.grainColor, variant.grainScale);
  drawMatteLighting(ctx, x, y, radius, 0.16, 0.12);
  ctx.fillStyle = variant.highlightColor;
  ctx.beginPath();
  ctx.arc(x - radius * 0.34, y - radius * 0.38, safeRadius(radius * 0.18), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBasketball(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, variant: BasketballVariant) {
  ctx.save();
  clipCircle(ctx, x, y, radius);
  const fill = ctx.createRadialGradient(x + radius * variant.highlightX, y + radius * variant.highlightY, radius * 0.1, x, y, radius);
  fill.addColorStop(0, variant.baseColor);
  fill.addColorStop(0.54, variant.baseColor);
  fill.addColorStop(1, variant.channelColor);
  ctx.fillStyle = fill;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  drawBallGrain(ctx, x, y, radius, variant.grainColor, variant.grainScale);
  ctx.strokeStyle = variant.channelColor;
  ctx.lineWidth = Math.max(2, radius * variant.seamWidth);
  ctx.beginPath();
  ctx.moveTo(x, y - radius);
  ctx.lineTo(x, y + radius);
  ctx.moveTo(x - radius, y);
  ctx.lineTo(x + radius, y);
  ctx.stroke();
  ctx.strokeStyle = variant.highlightColor;
  ctx.beginPath();
  ctx.ellipse(x - radius * 0.72, y, radius * 0.44, radius * 1.06, 0, -Math.PI / 2, Math.PI / 2);
  ctx.ellipse(x + radius * 0.72, y, radius * 0.44, radius * 1.06, 0, Math.PI / 2, Math.PI * 1.5);
  ctx.stroke();
  drawMatteLighting(ctx, x, y, radius, 0.22, 0.16);
  ctx.restore();
}

function drawFootball(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, variant: FootballVariant) {
  ctx.save();
  clipCircle(ctx, x, y, radius);
  const fill = ctx.createRadialGradient(x + radius * -0.24, y - radius * 0.36, radius * 0.08, x, y, radius);
  fill.addColorStop(0, variant.baseColor);
  fill.addColorStop(0.55, variant.baseColor);
  fill.addColorStop(1, variant.panelColor);
  ctx.fillStyle = fill;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  drawBallGrain(ctx, x, y, radius, variant.grainColor, variant.grainScale);
  ctx.translate(x, y);
  ctx.rotate(variant.seamAngle);
  ctx.fillStyle = `${variant.panelColor}88`;
  ctx.strokeStyle = variant.laceColor;
  ctx.lineWidth = Math.max(2, radius * variant.seamWidth);
  ctx.beginPath();
  ctx.ellipse(0, 0, radius * 0.82, radius * 0.46, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = variant.stitchColor;
  ctx.beginPath();
  ctx.moveTo(-radius * 0.28, 0);
  ctx.lineTo(radius * 0.28, 0);
  ctx.stroke();
  for (let index = -2; index <= 2; index += 1) {
    ctx.beginPath();
    ctx.moveTo(index * radius * variant.laceWidth, -radius * 0.08);
    ctx.lineTo(index * radius * variant.laceWidth, radius * 0.08);
    ctx.stroke();
  }
  ctx.rotate(-variant.seamAngle);
  ctx.translate(-x, -y);
  drawMatteLighting(ctx, x, y, radius, 0.22, 0.12);
  ctx.restore();
}

function drawTennisBall(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, variant: TennisVariant) {
  ctx.save();
  clipCircle(ctx, x, y, radius);
  const fill = ctx.createRadialGradient(x - radius * 0.28, y - radius * 0.38, radius * 0.08, x, y, radius);
  fill.addColorStop(0, variant.baseColor);
  fill.addColorStop(0.5, variant.baseColor);
  fill.addColorStop(1, variant.seamSoftColor);
  ctx.fillStyle = fill;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  drawBallGrain(ctx, x, y, radius, variant.grainColor, variant.grainScale);
  ctx.strokeStyle = variant.seamColor;
  ctx.lineWidth = Math.max(2, radius * 0.043);
  ctx.beginPath();
  ctx.ellipse(x - radius * 0.68, y, radius * 0.38, radius * 1.05, variant.seamCurve, -Math.PI / 2, Math.PI / 2);
  ctx.ellipse(x + radius * 0.68, y, radius * 0.38, radius * 1.05, variant.seamCurve, Math.PI / 2, Math.PI * 1.5);
  ctx.stroke();
  ctx.strokeStyle = variant.seamSoftColor;
  ctx.lineWidth = Math.max(1, radius * 0.018);
  ctx.beginPath();
  ctx.ellipse(x - radius * 0.68, y + radius * 0.02, radius * 0.42, radius * 1.08, variant.seamCurve, -Math.PI / 2, Math.PI / 2);
  ctx.ellipse(x + radius * 0.68, y + radius * 0.02, radius * 0.42, radius * 1.08, variant.seamCurve, Math.PI / 2, Math.PI * 1.5);
  ctx.stroke();
  drawMatteLighting(ctx, x, y, radius, 0.18, 0.14);
  ctx.fillStyle = variant.highlightColor;
  ctx.beginPath();
  ctx.arc(x - radius * 0.35, y - radius * 0.36, safeRadius(radius * 0.16), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBaseball(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, variant: BaseballVariant) {
  ctx.save();
  clipCircle(ctx, x, y, radius);
  ctx.fillStyle = variant.leatherColor;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  drawBallGrain(ctx, x, y, radius, variant.grainColor, variant.grainScale);
  ctx.strokeStyle = variant.seamColor;
  ctx.lineWidth = Math.max(1.4, radius * 0.024);
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(x + side * radius * 0.55, y, radius * 0.34, radius * 1.1, variant.seamAngle, Math.PI * 0.5, Math.PI * 1.5);
    ctx.stroke();
    ctx.strokeStyle = variant.stitchColor;
    for (let index = -4; index <= 4; index += 1) {
      const sy = y + index * radius * variant.stitchSpacing;
      const sx = x + side * radius * 0.5;
      ctx.beginPath();
      ctx.moveTo(sx - side * radius * 0.055, sy - radius * 0.045);
      ctx.lineTo(sx + side * radius * 0.055, sy + radius * 0.045);
      ctx.moveTo(sx - side * radius * 0.055, sy + radius * 0.045);
      ctx.lineTo(sx + side * radius * 0.055, sy - radius * 0.045);
      ctx.stroke();
    }
  }
  drawMatteLighting(ctx, x, y, radius, 0.2, 0.12);
  ctx.fillStyle = variant.highlightColor;
  ctx.beginPath();
  ctx.arc(x - radius * 0.38, y - radius * 0.38, safeRadius(radius * 0.18), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawHockeyPuck(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number) {
  ctx.save();
  clipCircle(ctx, x, y, radius);
  ctx.fillStyle = "#050505";
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  ctx.fillStyle = "#18181b";
  ctx.beginPath();
  ctx.ellipse(x, y + radius * 0.12, radius * 0.78, radius * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.24)";
  ctx.lineWidth = Math.max(1, radius * 0.025);
  ctx.beginPath();
  ctx.ellipse(x, y - radius * 0.1, radius * 0.74, radius * 0.32, 0, 0, Math.PI * 2);
  ctx.stroke();
  drawBallGloss(ctx, x, y, radius);
  ctx.restore();
}

function drawUfcBadge(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number) {
  ctx.save();
  clipCircle(ctx, x, y, radius);
  ctx.fillStyle = "#050505";
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  ctx.translate(x, y);
  ctx.strokeStyle = "#dc2626";
  ctx.fillStyle = "#111111";
  ctx.lineWidth = Math.max(3, radius * 0.05);
  ctx.beginPath();
  for (let index = 0; index < 8; index += 1) {
    const angle = Math.PI / 8 + (index * Math.PI * 2) / 8;
    const px = Math.cos(angle) * radius * 0.72;
    const py = Math.sin(angle) * radius * 0.72;
    if (index === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawF1Tire(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number) {
  ctx.save();
  clipCircle(ctx, x, y, radius);
  ctx.fillStyle = "#050505";
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  ctx.strokeStyle = "#27272a";
  ctx.lineWidth = Math.max(5, radius * 0.09);
  ctx.beginPath();
  ctx.arc(x, y, safeRadius(radius * 0.68), 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = "#eab308";
  ctx.lineWidth = Math.max(1.5, radius * 0.02);
  ctx.beginPath();
  ctx.arc(x, y, safeRadius(radius * 0.78), 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#18181b";
  ctx.beginPath();
  ctx.arc(x, y, safeRadius(radius * 0.28), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawSportBubble(ctx: CanvasRenderingContext2D, node: MarketBubbleNode, x: number, y: number, radius: number) {
  const asset = sportAssetForNode(node);
  const kind = sportBubbleKind(node);
  const assetRotation =
    kind === "basketball"
      ? ((hashVariant(node, "basketball-rotation", 9) - 4) / 120) * Math.PI
      : kind === "football"
        ? ((hashVariant(node, "football-rotation", 11) - 5) / 140) * Math.PI
        : kind === "tennis"
          ? ((hashVariant(node, "tennis-rotation", 7) - 3) / 160) * Math.PI
          : kind === "ufc"
            ? ((hashVariant(node, "ufc-rotation", 9) - 4) / 180) * Math.PI
            : kind === "soccer"
              ? ((hashVariant(node, "soccer-rotation", 5) - 2) / 320) * Math.PI
              : 0;
  const assetOpacity = kind === "ufc" ? 0.98 : kind === "basketball" ? 0.99 : 1;
  if (asset && drawClippedImageAsset(ctx, asset, x, y, radius, assetRotation, assetOpacity)) {
    return;
  }
  const soccer = soccerBallVariant(node);
  const basketball = basketballVariant(node);
  const baseball = baseballVariant(node);
  const tennis = tennisVariant(node);
  const football = footballVariant(node);
  switch (kind) {
    case "soccer":
      drawSoccerBall(ctx, x, y, radius, soccer);
      break;
    case "basketball":
      drawBasketball(ctx, x, y, radius, basketball);
      break;
    case "football":
      drawFootball(ctx, x, y, radius, football);
      break;
    case "tennis":
      drawTennisBall(ctx, x, y, radius, tennis);
      break;
    case "baseball":
      drawBaseball(ctx, x, y, radius, baseball);
      break;
    case "hockey":
      drawHockeyPuck(ctx, x, y, radius);
      break;
    case "ufc":
      drawUfcBadge(ctx, x, y, radius);
      break;
    case "f1":
      drawF1Tire(ctx, x, y, radius);
      break;
    default:
      drawFallbackGlassBubble(ctx, node, x, y, radius);
      break;
  }
}

function drawBubble(
  node: MarketBubbleNode,
  ctx: CanvasRenderingContext2D,
  globalScale: number,
  options: { hoveredId?: string | null; introStartedAt: number; isMobile: boolean; priorityPass?: boolean },
) {
  const now = Date.now();
  const introAlpha = Math.min(1, Math.max(0, (now - options.introStartedAt) / 900));
  const easeIntro = 1 - Math.pow(1 - introAlpha, 3);
  const isHovered = node.id === options.hoveredId;
  const radius = Math.max(8, safeRadius(safeNumber(node.val, 8), 8));
  const x = safeCoordinate(node.x);
  const y = safeCoordinate(node.y);
  const screenRadius = radius / safeRadius(globalScale, 1);
  const depth = Math.max(0, Math.min(1, (screenRadius - 12) / 36));
  const canRenderText = screenRadius >= (options.isMobile ? 24 : 18);
  const canRenderPrice = screenRadius >= (options.isMobile ? 28 : 22);
  const canRenderMovement = screenRadius >= (options.isMobile ? 42 : 34);
  const glowRadius = safeRadius(radius * (isHovered ? 1.2 : node.isTrending ? 1.12 : 1.03), radius);

  ctx.save();
  ctx.globalAlpha = easeIntro * (0.84 + depth * 0.16);

  const glow = ctx.createRadialGradient(x, y, safeRadius(radius * 0.86), x, y, glowRadius);
  glow.addColorStop(0, isHovered ? alphaColor(node.primaryColor, 0.34) : alphaColor(node.primaryColor, 0.14 + depth * 0.08));
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
  ctx.fill();

  if (node.visualPulseStartedAt && node.visualPulseDirection) {
    const pulseAge = now - node.visualPulseStartedAt;
    if (pulseAge >= 0 && pulseAge <= PULSE_FADE_MS) {
      const pulseProgress = pulseAge / PULSE_FADE_MS;
      const pulseAlpha = (1 - pulseProgress) * 0.3;
      const pulseRadius = radius * (1.02 + pulseProgress * 0.12);
      const pulseColor = node.visualPulseDirection === "up" ? `rgba(52,211,153,${pulseAlpha})` : `rgba(251,113,133,${pulseAlpha})`;
      ctx.strokeStyle = pulseColor;
      ctx.lineWidth = Math.max(2, radius * 0.035 * (1 - pulseProgress * 0.45));
      ctx.beginPath();
      ctx.arc(x, y, safeRadius(pulseRadius), 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  drawSportBubble(ctx, node, x, y, radius);

  ctx.lineWidth = isHovered || options.priorityPass ? 4 : 2;
  ctx.strokeStyle = alphaColor(node.primaryColor, isHovered || options.priorityPass ? 0.88 : 0.48 + depth * 0.18);
  ctx.beginPath();
  ctx.arc(x, y, safeRadius(radius - ctx.lineWidth / 2), 0, Math.PI * 2);
  ctx.stroke();

  ctx.lineWidth = 1;
  ctx.strokeStyle = alphaColor(node.secondaryColor, 0.18 + depth * 0.12);
  ctx.beginPath();
  ctx.arc(x, y, safeRadius(radius - Math.max(4, radius * 0.1)), 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = `rgba(255,255,255,${0.22 + depth * 0.12})`;
  ctx.lineWidth = Math.max(1, radius * 0.018);
  ctx.beginPath();
  ctx.arc(x, y, safeRadius(radius * 0.82), Math.PI * 1.08, Math.PI * 1.85);
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  if (canRenderText) {
    drawLabelPlate(ctx, x, y, radius);
    drawLogoMark(node, ctx, x, y - radius * 0.5, radius, screenRadius > 34 ? 0.93 : 0.88);

    ctx.fillStyle = "#f8fafc";
    ctx.font = `900 ${Math.max(13, radius * (node.favoredOutcome.length > 9 ? 0.21 : 0.25))}px Inter, ui-sans-serif, system-ui, sans-serif`;
    drawTextLine(ctx, node.favoredOutcome, x, y - radius * 0.03, radius * 1.48);
  }

  if (canRenderPrice) {
    ctx.fillStyle = "#ffffff";
    ctx.font = `950 ${Math.max(18, radius * 0.32)}px Inter, ui-sans-serif, system-ui, sans-serif`;
    drawTextLine(ctx, formatCents(node.favoredPrice), x, y + radius * 0.29, radius * 1.2);
  }

  if (canRenderMovement) {
    ctx.fillStyle = node.priceChange >= 0 ? "#7CFFB2" : "#FF7A84";
    ctx.font = `800 ${Math.max(8, radius * 0.12)}px Inter, ui-sans-serif, system-ui, sans-serif`;
    drawTextLine(ctx, pct(node.priceChange), x, y + radius * 0.56, radius * 1.0);
  }

  if (options.priorityPass) {
    ctx.lineWidth = 2;
    ctx.strokeStyle = alphaColor(node.primaryColor, 0.72);
    ctx.beginPath();
    ctx.arc(x, y, safeRadius(radius + 1.5), 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}

function TraakLoadingOverlay() {
  return (
    <div
      aria-label="Loading Traak markets"
      className="absolute inset-0 grid place-items-center bg-black/24 text-slate-100 transition-opacity duration-300"
      data-testid="traak-loader"
      role="status"
    >
      <style>{`
        @keyframes traak-breathe {
          0%, 100% { transform: scale(0.97); opacity: 0.78; }
          50% { transform: scale(1.03); opacity: 1; }
        }
      `}</style>
      <div className="relative grid place-items-center px-6 text-center">
        <div
          className="absolute h-36 w-36 rounded-full bg-cyan-400/8 blur-2xl"
          style={{ animation: "traak-breathe 3.4s ease-in-out infinite" }}
        />
        <div
          className="absolute h-28 w-28 rounded-full border border-cyan-300/15 shadow-[0_0_52px_rgba(34,211,238,0.18)]"
          style={{ animation: "traak-breathe 2.8s ease-in-out infinite reverse" }}
        />
        <div className="relative h-28 w-28 overflow-hidden rounded-full shadow-[0_0_44px_rgba(34,211,238,0.16)]">
          <img alt="Traak logo" className="h-full w-full select-none object-cover" src="/polytraak.jpg" style={{ animation: "traak-breathe 2.4s ease-in-out infinite" }} />
        </div>
      </div>
    </div>
  );
}

export function MarketBubbleMap({
  markets,
  isLoading = false,
  isRefreshing = false,
  activeSport,
}: {
  markets: TerminalMarket[];
  isLoading?: boolean;
  isRefreshing?: boolean;
  activeSport?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<number | null>(null);
  const bodiesRef = useRef<BubbleBody[]>([]);
  const layoutRef = useRef({ ids: "", width: 0, height: 0, isMobile: false });
  const visualStatesRef = useRef(new Map<string, BubbleVisualSmoothingState>());
  const [introStartedAt] = useState(() => Date.now());
  const [loadingVisible, setLoadingVisible] = useState(isLoading);
  const [selectedMarketId, setSelectedMarketId] = useState<string | null>(null);
  const [selectedPanelSnapshot, setSelectedPanelSnapshot] = useState<MarketBubbleNode | null>(null);
  const [hoveredMarket, setHoveredMarket] = useState<MarketBubbleNode | null>(null);
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const [dimensions, setDimensions] = useState({ width: 1200, height: 680 });

  const nodes = useMemo(() => markets.map((market, index) => marketToBubbleNode(market, index)), [markets]);
  const particles = useMemo(() => createBackgroundParticles(), []);
  const isMobile = dimensions.width < 640;
  const bodyCount = nodes.length;
  const selectedMarket = useMemo(() => selectedPanelSnapshot ?? nodes.find((node) => node.id === selectedMarketId) ?? null, [nodes, selectedMarketId, selectedPanelSnapshot]);
  const backgroundTheme = useMemo(() => backgroundThemeForSport(activeSport ?? nodes[0]?.sport), [activeSport, nodes]);
  const backgroundTransitionRef = useRef({ previous: backgroundTheme as BackgroundTheme | null, current: backgroundTheme, startedAt: Date.now() });

  useEffect(() => {
    if (isLoading) {
      setLoadingVisible(true);
      return;
    }
    const timer = window.setTimeout(() => setLoadingVisible(false), 300);
    return () => window.clearTimeout(timer);
  }, [isLoading]);

  useEffect(() => {
    const current = backgroundTransitionRef.current.current;
    if (current !== backgroundTheme) {
      backgroundTransitionRef.current = { previous: current, current: backgroundTheme, startedAt: Date.now() };
    }
  }, [backgroundTheme]);

  useEffect(() => {
    const ids = nodes.map((node) => node.id).join("|");
    const nextBodies = createBubbleBodies(nodes, dimensions.width, dimensions.height, isMobile);
    const canMerge =
      ids === layoutRef.current.ids &&
      dimensions.width === layoutRef.current.width &&
      dimensions.height === layoutRef.current.height &&
      isMobile === layoutRef.current.isMobile;
    bodiesRef.current = canMerge ? mergeBubbleBodies(bodiesRef.current, nextBodies, dimensions.width, dimensions.height) : nextBodies;
    const visibleIds = new Set(bodiesRef.current.map((body) => body.id));
    for (const body of bodiesRef.current) {
      if (!visualStatesRef.current.has(body.id)) {
        visualStatesRef.current.set(body.id, createBubbleVisualSmoothingState(body));
      }
    }
    for (const id of visualStatesRef.current.keys()) {
      if (!visibleIds.has(id)) visualStatesRef.current.delete(id);
    }
    layoutRef.current = { ids, width: dimensions.width, height: dimensions.height, isMobile };
    const timer = window.setTimeout(() => setHoveredMarket(null), 0);
    return () => window.clearTimeout(timer);
  }, [dimensions.height, dimensions.width, isMobile, nodes]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const updateDimensions = () => {
      const rect = node.getBoundingClientRect();
      setDimensions({
        width: Math.max(320, Math.floor(rect.width || window.innerWidth || 1200)),
        height: Math.max(420, Math.floor(rect.height || 680)),
      });
    };
    updateDimensions();
    if (!("ResizeObserver" in window)) return;
    const observer = new ResizeObserver(updateDimensions);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.floor(dimensions.width * pixelRatio);
    canvas.height = Math.floor(dimensions.height * pixelRatio);
    canvas.style.width = `${dimensions.width}px`;
    canvas.style.height = `${dimensions.height}px`;

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";

    const drawFrame = () => {
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      const transition = backgroundTransitionRef.current;
      const fadeProgress = transition.previous && transition.previous !== transition.current ? Math.min(1, (Date.now() - transition.startedAt) / 420) : 1;
      if (transition.previous && transition.previous !== transition.current) {
        drawBackgroundTheme(context, transition.previous, dimensions.width, dimensions.height, 1 - fadeProgress, pixelRatio, particles);
      }
      drawBackgroundTheme(context, transition.current, dimensions.width, dimensions.height, transition.previous && transition.previous !== transition.current ? fadeProgress : 1, pixelRatio, particles);
      tickBubblePhysics(bodiesRef.current, dimensions.width, dimensions.height, 1, isMobile);
      resolveOverlapsBeforeDraw(bodiesRef.current, dimensions.width, dimensions.height, isMobile);
      const hoveredId = hoveredMarket?.id;
      for (const node of bodiesRef.current) {
        if (node.x + node.radius < -80 || node.x - node.radius > dimensions.width + 80 || node.y + node.radius < -80 || node.y - node.radius > dimensions.height + 80) {
          continue;
        }
        if (node.id !== hoveredId) drawBubble(node, context, 1, { hoveredId, introStartedAt, isMobile });
      }
      const hoveredNode = hoveredId ? bodiesRef.current.find((node) => node.id === hoveredId) : null;
      if (hoveredNode) drawBubble(hoveredNode, context, 1, { hoveredId, introStartedAt, isMobile, priorityPass: true });
      frameRef.current = window.requestAnimationFrame(drawFrame);
    };

    drawFrame();
    return () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [dimensions.height, dimensions.width, hoveredMarket?.id, introStartedAt, isMobile, particles]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedMarketId(null);
        setSelectedPanelSnapshot(null);
        marketStore.setSelectedMarketId(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const findNodeAtPoint = useCallback(
    (x: number, y: number) => {
      let bestNode: MarketBubbleNode | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const node of bodiesRef.current) {
        const dx = x - node.x;
        const dy = y - node.y;
        const distance = Math.hypot(dx, dy);
        if (distance <= node.val + 5 && distance < bestDistance) {
          bestNode = node;
          bestDistance = distance;
        }
      }
      return bestNode;
    },
    [],
  );

  const handleMouseMove = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const nextPointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    setPointer(nextPointer);
    const nextHovered = findNodeAtPoint(nextPointer.x, nextPointer.y);
    const canvas = canvasRef.current;
    if (canvas) canvas.style.cursor = nextHovered ? "pointer" : "default";
    setHoveredMarket((current) => (current?.id === nextHovered?.id ? current : nextHovered));
  }, [findNodeAtPoint]);

  const handleMouseLeave = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas) canvas.style.cursor = "default";
    setHoveredMarket(null);
  }, []);

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const node = findNodeAtPoint(event.clientX - rect.left, event.clientY - rect.top);
      if (node) {
        setSelectedMarketId(node.id);
        setSelectedPanelSnapshot({ ...node, outcomes: node.outcomes.map((outcome) => ({ ...outcome })) });
        marketStore.setSelectedMarketId(node.id);
      }
    },
    [findNodeAtPoint],
  );

  return (
    <div
      aria-label={`${bodyCount} sports market bubble map`}
      className="relative h-[calc(100vh-5.45rem)] min-h-[480px] w-screen overflow-hidden bg-[#050505] sm:h-[calc(100vh-5.15rem)]"
      onClick={handleClick}
      onMouseLeave={handleMouseLeave}
      onMouseMove={handleMouseMove}
      role="application"
    >
      <div ref={containerRef} className="h-full w-full">
        <canvas aria-hidden="true" className="block h-full w-full" data-testid="bubble-canvas" ref={canvasRef} />
      </div>

      {hoveredMarket ? (
        <div
          className="pointer-events-none absolute z-20 w-72 rounded-lg border border-slate-700/80 bg-slate-950/92 p-3 text-xs text-slate-200 shadow-2xl shadow-black/40 backdrop-blur"
          style={{ left: Math.min(pointer.x + 14, Math.max(12, dimensions.width - 300)), top: Math.min(pointer.y + 14, Math.max(12, dimensions.height - 140)) }}
        >
          <p className="line-clamp-2 font-semibold text-slate-50">{hoveredMarket.title}</p>
          <div className="mt-2 grid grid-cols-2 gap-2 text-slate-400">
            <span>Favored</span>
            <span className="text-right text-slate-100">
              {hoveredMarket.favoredOutcome} {formatCents(hoveredMarket.favoredPrice)}
            </span>
            <span>Liquidity</span>
            <span className="text-right text-slate-100">{money(hoveredMarket.liquidity)}</span>
            <span>Movement</span>
            <span className={hoveredMarket.priceChange >= 0 ? "text-right text-emerald-200" : "text-right text-rose-200"}>{pct(hoveredMarket.priceChange)}</span>
          </div>
        </div>
      ) : null}

      {loadingVisible ? (
        <div className={`absolute inset-0 transition-opacity duration-300 ${isLoading ? "opacity-100" : "pointer-events-none opacity-0"}`}>
          <TraakLoadingOverlay />
        </div>
      ) : null}

      {isRefreshing ? (
        <div className="absolute left-3 top-3 rounded-full border border-cyan-400/30 bg-slate-950/80 px-3 py-1 text-xs text-cyan-100">
          Refreshing
        </div>
      ) : null}

      {bodyCount === 0 && !loadingVisible ? (
        <div className="absolute inset-0 grid place-items-center text-sm text-slate-400">No sports markets matched this view.</div>
      ) : null}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex min-h-10 flex-wrap items-center justify-between gap-3 border-t border-zinc-800/80 bg-black/55 px-5 py-2 text-xs font-semibold text-zinc-200 backdrop-blur-sm">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {[
            ["Strong Up", "#16C784"],
            ["Up", "#4CAF50"],
            ["Neutral", "#B8C0CC"],
            ["Down", "#FF3B45"],
            ["Strong Down", "#B91C1C"],
          ].map(([label, color]) => (
            <span className="flex items-center gap-2" key={label}>
              <span className="h-3 w-3 rounded-full shadow-[0_0_10px_currentColor]" style={{ backgroundColor: color, color }} />
              {label}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2 text-zinc-300">
          <span>Data from</span>
          <span className="font-bold text-white">Polymarket</span>
        </div>
      </div>

      {selectedMarket ? (
        <>
          <div
            aria-hidden="true"
            className="absolute inset-0 z-20 bg-black/10"
            onClick={(event) => {
              event.stopPropagation();
              setSelectedMarketId(null);
              setSelectedPanelSnapshot(null);
              marketStore.setSelectedMarketId(null);
            }}
          />
          <MarketTradePanel
            key={selectedMarket.id}
            market={selectedMarket}
            onUpdatePrices={fetchLatestMarketForNode}
            onClose={() => {
              setSelectedMarketId(null);
              setSelectedPanelSnapshot(null);
              marketStore.setSelectedMarketId(null);
            }}
          />
        </>
      ) : null}
    </div>
  );
}
