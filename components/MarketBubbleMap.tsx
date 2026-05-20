"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MarketTradePanel } from "@/components/MarketTradePanel";
import { marketStore, useMarketStore, type MarketValueState } from "@/app/store/marketStore";
import { findTeamStyleMatch, marketBubbleRadius, momentumGlowColor } from "@/lib/sports/teamStyles";
import type { TerminalMarket } from "@/lib/polymarket/types";

export type MarketBubbleNode = {
  id: string;
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

export type BubbleBody = MarketBubbleNode & {
  radius: number;
  mass: number;
  vx: number;
  vy: number;
};

const DESKTOP_COLLISION_PADDING = 6;
const MOBILE_COLLISION_PADDING = 4;
const MAX_BUBBLE_SPEED = 0.35;
const VELOCITY_DAMPING = 0.995;
const WALL_BOUNCE = 0.42;
const COLLISION_BOUNCE = 0.18;

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
  return names.map((name, index) => {
    const price = clamp01(prices[index]);
    return {
      name: cleanOutcomeName(name, market.title),
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

function applyMarketValueToBody(body: BubbleBody, market: TerminalMarket, index: number, value?: MarketValueState) {
  const visual = marketToBubbleNode(market, index);
  body.title = visual.title;
  body.sport = visual.sport;
  body.volume = value?.volume ?? visual.volume;
  body.liquidity = value?.liquidity ?? visual.liquidity;
  body.priceChange = value?.movement ?? visual.priceChange;
  body.marketUrl = visual.marketUrl;
  body.polymarketUrl = visual.polymarketUrl;
  body.tradeUrl = visual.tradeUrl;
  body.logoUrl = visual.logoUrl;
  body.logoPath = visual.logoPath;
  body.primaryColor = visual.primaryColor;
  body.secondaryColor = visual.secondaryColor;
  body.glowColor = visual.glowColor;
  body.favoredOutcome = visual.favoredOutcome;
  body.favoredPrice = visual.favoredPrice;
  body.priceCents = visual.priceCents;
  body.outcomes = visual.outcomes;
  body.bestBid = value?.bestBid ?? visual.bestBid;
  body.bestAsk = value?.bestAsk ?? visual.bestAsk;
  body.trendScore = visual.trendScore;
  body.isTrending = visual.isTrending;
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

function drawBackground(ctx: CanvasRenderingContext2D, particles: BackgroundParticle[], pixelRatio: number, isMobile: boolean) {
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  const particleLimit = Math.min(particles.length, isMobile ? 55 : pixelRatio > 1.5 ? 95 : 130);

  ctx.save();
  ctx.resetTransform();
  ctx.fillStyle = "#050505";
  ctx.fillRect(0, 0, width, height);
  const shade = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.08, width / 2, height / 2, Math.max(width, height) * 0.72);
  shade.addColorStop(0, "rgba(24, 24, 27, 0.28)");
  shade.addColorStop(0.58, "rgba(3, 7, 18, 0.55)");
  shade.addColorStop(1, "rgba(0, 0, 0, 0.94)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, width, height);

  for (const particle of particles.slice(0, particleLimit)) {
    ctx.globalAlpha = particle.alpha;
    ctx.fillStyle = particle.color;
    ctx.shadowColor = particle.color;
    ctx.shadowBlur = particle.size * 4;
    ctx.beginPath();
    ctx.arc(safeCoordinate(particle.x * width), safeCoordinate(particle.y * height), safeRadius(particle.size), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;

  const vignette = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.38, width / 2, height / 2, Math.max(width, height) * 0.76);
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
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
  const logoSize = safeRadius(safeBubbleRadius * 0.32, 4);
  const logoX = safeCoordinate(x);
  const logoY = safeCoordinate(y);

  ctx.save();
  ctx.globalAlpha *= opacity;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const bitmap = logo?.bitmap;
  const image = logo?.image;
  const drawable = bitmap ?? (image?.complete && image.naturalWidth > 0 ? image : null);
  if (drawable) {
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

function clipCircle(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number) {
  ctx.beginPath();
  ctx.arc(x, y, safeRadius(radius), 0, Math.PI * 2);
  ctx.clip();
}

function drawBallGloss(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number) {
  const gloss = ctx.createRadialGradient(x - radius * 0.35, y - radius * 0.42, radius * 0.06, x, y, radius);
  gloss.addColorStop(0, "rgba(255,255,255,0.34)");
  gloss.addColorStop(0.35, "rgba(255,255,255,0.08)");
  gloss.addColorStop(1, "rgba(0,0,0,0.34)");
  ctx.fillStyle = gloss;
  ctx.beginPath();
  ctx.arc(x, y, safeRadius(radius), 0, Math.PI * 2);
  ctx.fill();
}

function drawCenterTextOverlay(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number) {
  const overlay = ctx.createRadialGradient(x, y, radius * 0.1, x, y, radius * 0.72);
  overlay.addColorStop(0, "rgba(0,0,0,0.58)");
  overlay.addColorStop(0.62, "rgba(0,0,0,0.38)");
  overlay.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = overlay;
  ctx.beginPath();
  ctx.arc(x, y, safeRadius(radius * 0.72), 0, Math.PI * 2);
  ctx.fill();
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

function drawSoccerBall(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number) {
  ctx.save();
  clipCircle(ctx, x, y, radius);
  ctx.fillStyle = "#f9fafb";
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  const shade = ctx.createRadialGradient(x - radius * 0.25, y - radius * 0.32, radius * 0.1, x, y, radius);
  shade.addColorStop(0, "rgba(255,255,255,0.8)");
  shade.addColorStop(0.72, "rgba(229,231,235,0.2)");
  shade.addColorStop(1, "rgba(15,23,42,0.14)");
  ctx.fillStyle = shade;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  ctx.strokeStyle = "rgba(17,24,39,0.82)";
  ctx.lineWidth = Math.max(1.1, radius * 0.018);
  const pentagonRadius = radius * 0.22;
  ctx.beginPath();
  for (let index = 0; index < 5; index += 1) {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / 5;
    const px = x + Math.cos(angle) * pentagonRadius;
    const py = y + Math.sin(angle) * pentagonRadius;
    if (index === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = "#050505";
  ctx.fill();
  ctx.stroke();
  for (let index = 0; index < 5; index += 1) {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / 5;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(angle) * pentagonRadius, y + Math.sin(angle) * pentagonRadius);
    ctx.lineTo(x + Math.cos(angle) * radius * 0.86, y + Math.sin(angle) * radius * 0.86);
    ctx.stroke();
    ctx.beginPath();
    const panelX = x + Math.cos(angle) * radius * 0.62;
    const panelY = y + Math.sin(angle) * radius * 0.62;
    for (let point = 0; point < 6; point += 1) {
      const hexAngle = Math.PI / 6 + (point * Math.PI * 2) / 6;
      const px = panelX + Math.cos(hexAngle) * radius * 0.12;
      const py = panelY + Math.sin(hexAngle) * radius * 0.12;
      if (point === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = "#050505";
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawBasketball(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number) {
  ctx.save();
  clipCircle(ctx, x, y, radius);
  const fill = ctx.createRadialGradient(x - radius * 0.3, y - radius * 0.35, radius * 0.08, x, y, radius);
  fill.addColorStop(0, "#fb923c");
  fill.addColorStop(0.55, "#d97706");
  fill.addColorStop(1, "#7c2d12");
  ctx.fillStyle = fill;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  ctx.strokeStyle = "rgba(17,24,39,0.9)";
  ctx.lineWidth = Math.max(2, radius * 0.055);
  ctx.beginPath();
  ctx.moveTo(x, y - radius);
  ctx.lineTo(x, y + radius);
  ctx.moveTo(x - radius, y);
  ctx.lineTo(x + radius, y);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(x - radius * 0.72, y, radius * 0.44, radius * 1.06, 0, -Math.PI / 2, Math.PI / 2);
  ctx.ellipse(x + radius * 0.72, y, radius * 0.44, radius * 1.06, 0, Math.PI / 2, Math.PI * 1.5);
  ctx.stroke();
  drawBallGloss(ctx, x, y, radius);
  ctx.restore();
}

function drawFootball(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number) {
  ctx.save();
  clipCircle(ctx, x, y, radius);
  drawFallbackGlassBubble(ctx, { primaryColor: "#7c2d12", secondaryColor: "#fef3c7" } as MarketBubbleNode, x, y, radius);
  ctx.translate(x, y);
  ctx.rotate(-0.18);
  ctx.fillStyle = "#7c2d12";
  ctx.strokeStyle = "#fef3c7";
  ctx.lineWidth = Math.max(2, radius * 0.04);
  ctx.beginPath();
  ctx.ellipse(0, 0, radius * 0.82, radius * 0.46, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-radius * 0.28, 0);
  ctx.lineTo(radius * 0.28, 0);
  ctx.stroke();
  for (let index = -2; index <= 2; index += 1) {
    ctx.beginPath();
    ctx.moveTo(index * radius * 0.09, -radius * 0.08);
    ctx.lineTo(index * radius * 0.09, radius * 0.08);
    ctx.stroke();
  }
  ctx.restore();
}

function drawTennisBall(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number) {
  ctx.save();
  clipCircle(ctx, x, y, radius);
  const fill = ctx.createRadialGradient(x - radius * 0.28, y - radius * 0.38, radius * 0.08, x, y, radius);
  fill.addColorStop(0, "#ecfccb");
  fill.addColorStop(0.48, "#a3e635");
  fill.addColorStop(1, "#4d7c0f");
  ctx.fillStyle = fill;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  ctx.strokeStyle = "rgba(255,255,255,0.88)";
  ctx.lineWidth = Math.max(2, radius * 0.045);
  ctx.beginPath();
  ctx.ellipse(x - radius * 0.68, y, radius * 0.38, radius * 1.05, -0.15, -Math.PI / 2, Math.PI / 2);
  ctx.ellipse(x + radius * 0.68, y, radius * 0.38, radius * 1.05, -0.15, Math.PI / 2, Math.PI * 1.5);
  ctx.stroke();
  drawBallGloss(ctx, x, y, radius);
  ctx.restore();
}

function drawBaseball(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number) {
  ctx.save();
  clipCircle(ctx, x, y, radius);
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  ctx.strokeStyle = "#b91c1c";
  ctx.lineWidth = Math.max(1.5, radius * 0.028);
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(x + side * radius * 0.55, y, radius * 0.34, radius * 1.1, 0, Math.PI * 0.5, Math.PI * 1.5);
    ctx.stroke();
    for (let index = -4; index <= 4; index += 1) {
      const sy = y + index * radius * 0.13;
      ctx.beginPath();
      ctx.moveTo(x + side * radius * 0.43, sy - radius * 0.04);
      ctx.lineTo(x + side * radius * 0.55, sy + radius * 0.04);
      ctx.stroke();
    }
  }
  drawBallGloss(ctx, x, y, radius);
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
  switch (sportBubbleKind(node)) {
    case "soccer":
      drawSoccerBall(ctx, x, y, radius);
      break;
    case "basketball":
      drawBasketball(ctx, x, y, radius);
      break;
    case "football":
      drawFootball(ctx, x, y, radius);
      break;
    case "tennis":
      drawTennisBall(ctx, x, y, radius);
      break;
    case "baseball":
      drawBaseball(ctx, x, y, radius);
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
  drawCenterTextOverlay(ctx, x, y, radius);
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
  const canRenderText = screenRadius >= (options.isMobile ? 24 : 18);
  const canRenderPrice = screenRadius >= (options.isMobile ? 28 : 22);
  const canRenderMovement = screenRadius >= (options.isMobile ? 42 : 34);
  const glowRadius = safeRadius(radius * (isHovered ? 1.2 : node.isTrending ? 1.12 : 1.06), radius);

  ctx.save();
  ctx.globalAlpha = easeIntro;

  const glow = ctx.createRadialGradient(x, y, safeRadius(radius * 0.86), x, y, glowRadius);
  glow.addColorStop(0, isHovered ? alphaColor(node.primaryColor, 0.42) : alphaColor(node.primaryColor, 0.25));
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
  ctx.fill();

  drawSportBubble(ctx, node, x, y, radius);

  ctx.lineWidth = isHovered || options.priorityPass ? 4 : 2;
  ctx.strokeStyle = alphaColor(node.primaryColor, isHovered || options.priorityPass ? 0.88 : 0.52);
  ctx.beginPath();
  ctx.arc(x, y, safeRadius(radius - ctx.lineWidth / 2), 0, Math.PI * 2);
  ctx.stroke();

  ctx.lineWidth = 1;
  ctx.strokeStyle = alphaColor(node.secondaryColor, 0.26);
  ctx.beginPath();
  ctx.arc(x, y, safeRadius(radius - Math.max(4, radius * 0.1)), 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = Math.max(1, radius * 0.018);
  ctx.beginPath();
  ctx.arc(x, y, safeRadius(radius * 0.82), Math.PI * 1.08, Math.PI * 1.85);
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  if (canRenderText) {
    drawLogoMark(node, ctx, x, y - radius * 0.42, radius, screenRadius > 34 ? 0.92 : 0.55);

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

export function MarketBubbleMap({
  markets,
  isLoading = false,
  isRefreshing = false,
}: {
  markets: TerminalMarket[];
  isLoading?: boolean;
  isRefreshing?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<number | null>(null);
  const bodiesRef = useRef<BubbleBody[]>([]);
  const layoutRef = useRef({ ids: "", width: 0, height: 0, isMobile: false });
  const [introStartedAt] = useState(() => Date.now());
  const [selectedMarketId, setSelectedMarketId] = useState<string | null>(null);
  const [hoveredMarket, setHoveredMarket] = useState<MarketBubbleNode | null>(null);
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const [dimensions, setDimensions] = useState({ width: 1200, height: 680 });

  const nodes = useMemo(() => markets.map((market, index) => marketToBubbleNode(market, index)), [markets]);
  const particles = useMemo(() => createBackgroundParticles(), []);
  const isMobile = dimensions.width < 640;
  const bodyCount = nodes.length;
  const selectedStoreMarket = useMarketStore((snapshot) => (selectedMarketId ? snapshot.marketsById[selectedMarketId] ?? null : null));
  const selectedMarket = useMemo(
    () => (selectedStoreMarket ? marketToBubbleNode(selectedStoreMarket) : nodes.find((node) => node.id === selectedMarketId) ?? null),
    [nodes, selectedMarketId, selectedStoreMarket],
  );

  useEffect(() => {
    const ids = nodes.map((node) => node.id).join("|");
    const nextBodies = createBubbleBodies(nodes, dimensions.width, dimensions.height, isMobile);
    const canMerge =
      ids === layoutRef.current.ids &&
      dimensions.width === layoutRef.current.width &&
      dimensions.height === layoutRef.current.height &&
      isMobile === layoutRef.current.isMobile;
    bodiesRef.current = canMerge ? mergeBubbleBodies(bodiesRef.current, nextBodies, dimensions.width, dimensions.height) : nextBodies;
    layoutRef.current = { ids, width: dimensions.width, height: dimensions.height, isMobile };
    const timer = window.setTimeout(() => setHoveredMarket(null), 0);
    return () => window.clearTimeout(timer);
  }, [dimensions.height, dimensions.width, isMobile, nodes]);

  useEffect(() => {
    const visibleIndexById = new Map(nodes.map((node, index) => [node.id, index]));
    return marketStore.subscribe(() => {
      const snapshot = marketStore.getState();
      for (const body of bodiesRef.current) {
        const index = visibleIndexById.get(body.id);
        const market = snapshot.marketsById[body.id];
        if (index === undefined || !market) continue;
        applyMarketValueToBody(body, market, index, snapshot.marketValuesById[body.id]);
      }
    });
  }, [nodes]);

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
      drawBackground(context, particles, pixelRatio, isMobile);
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

      {isLoading ? (
        <div className="absolute inset-0 grid place-items-center bg-slate-950/60 text-sm text-slate-300">Loading sports bubbles...</div>
      ) : null}

      {isRefreshing ? (
        <div className="absolute left-3 top-3 rounded-full border border-cyan-400/30 bg-slate-950/80 px-3 py-1 text-xs text-cyan-100">
          Refreshing
        </div>
      ) : null}

      {bodyCount === 0 && !isLoading ? (
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
              marketStore.setSelectedMarketId(null);
            }}
          />
          <MarketTradePanel
            market={selectedMarket}
            onClose={() => {
              setSelectedMarketId(null);
              marketStore.setSelectedMarketId(null);
            }}
          />
        </>
      ) : null}
    </div>
  );
}
