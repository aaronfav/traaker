"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
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
  tradeUrl?: string;
  logoUrl?: string;
  primaryColor: string;
  secondaryColor: string;
  glowColor: string;
  favoredOutcome: string;
  favoredPrice: number;
  priceCents: number;
  outcomes: MarketOutcomeOption[];
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
};

type BackgroundParticle = {
  x: number;
  y: number;
  size: number;
  alpha: number;
  color: string;
};

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
const logoCache = new Map<string, HTMLImageElement>();

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

function getLogoImage(logoUrl?: string) {
  if (!logoUrl || typeof window === "undefined") return null;
  const cached = logoCache.get(logoUrl);
  if (cached) return cached;
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = logoUrl;
  logoCache.set(logoUrl, image);
  return image;
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

const clampPosition = (value: number, radius: number, max: number) => Math.max(radius + 4, Math.min(max - radius - 4, value));

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
    tradeUrl: `/trade/${market.id}`,
    logoUrl: style.logoUrl ?? market.image,
    primaryColor: style.primary,
    secondaryColor: style.secondary,
    glowColor: momentumGlowColor(priceChange, volume),
    favoredOutcome: compactOutcomeName(favored.name),
    favoredPrice: favored.price,
    priceCents: favored.priceCents,
    outcomes,
    trendScore,
    isTrending: trendScore >= 10 || Math.abs(priceChange) >= 0.05 || safeNumber(market.recentTradesCount) >= 40 || safeNumber(market.volumeAcceleration) >= 1.5,
    driftPhase: (hashString(market.id) % 628) / 100,
    val,
    targetX: position.x,
    targetY: position.y,
    ...position,
  };
}

export function layoutBubbleNodes(nodes: MarketBubbleNode[], width: number, height: number, isMobile = false): MarketBubbleNode[] {
  const boardWidth = Math.max(320, safeNumber(width, 1200));
  const boardHeight = Math.max(420, safeNumber(height, 680));
  const footerReserve = isMobile ? 64 : 50;
  const topReserve = isMobile ? 14 : 10;
  const usableHeight = Math.max(320, boardHeight - footerReserve - topReserve);
  const totalArea = nodes.reduce((sum, node) => sum + Math.PI * Math.pow(safeRadius(node.val, 8) + 5, 2), 0);
  const targetArea = boardWidth * usableHeight * (isMobile ? 0.72 : 0.82);
  const densityScale = totalArea > 0 ? Math.min(1, Math.max(isMobile ? 0.64 : 0.82, Math.sqrt(targetArea / totalArea))) : 1;
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
      const y = clampPosition(topReserve + usableHeight * yUnit, val, boardHeight - footerReserve * 0.36);
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
    const y = clampPosition(topReserve + usableHeight * yUnit, val, boardHeight - footerReserve * 0.36);
    return { ...node, val, x, y, targetX: x, targetY: y };
  });

  for (let iteration = 0; iteration < 72; iteration += 1) {
    let moved = false;
    for (let leftIndex = 0; leftIndex < placed.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < placed.length; rightIndex += 1) {
        const left = placed[leftIndex];
        const right = placed[rightIndex];
        const padding = leftIndex < 5 || rightIndex < 5 ? 8 : 5;
        const minDistance = left.val + right.val + padding;
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
        left.y = clampPosition(left.y - ny * push * leftWeight, left.val, boardHeight - footerReserve * 0.36);
        right.x = clampPosition(right.x + nx * push * rightWeight, right.val, boardWidth);
        right.y = clampPosition(right.y + ny * push * rightWeight, right.val, boardHeight - footerReserve * 0.36);
        moved = true;
      }
    }
    if (!moved) break;
  }

  return placed.map((node) => ({ ...node, targetX: node.x, targetY: node.y }));
}

function drawBackground(ctx: CanvasRenderingContext2D, particles: BackgroundParticle[]) {
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;

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

  for (const particle of particles) {
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
  const logo = getLogoImage(node.logoUrl);
  const safeBubbleRadius = safeRadius(radius, 8);
  const logoSize = safeRadius(safeBubbleRadius * 0.38, 4);
  const logoX = safeCoordinate(x);
  const logoY = safeCoordinate(y);

  ctx.save();
  ctx.globalAlpha *= opacity;
  if (logo?.complete && logo.naturalWidth > 0) {
    ctx.beginPath();
    ctx.arc(logoX, logoY, safeRadius(logoSize / 2), 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(logo, logoX - logoSize / 2, logoY - logoSize / 2, logoSize, logoSize);
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
  const driftPhase = safeNumber(node.driftPhase);
  const radius = Math.max(8, safeRadius(safeNumber(node.val, 8), 8));
  const driftStrength = options.isMobile ? 1.25 : 2;
  const x = safeCoordinate(node.x) + Math.sin(now / 5200 + driftPhase) * driftStrength;
  const y = safeCoordinate(node.y) + Math.cos(now / 6100 + driftPhase * 1.2) * driftStrength;
  const screenRadius = radius / safeRadius(globalScale, 1);
  const canRenderText = screenRadius >= (options.isMobile ? 24 : 18);
  const canRenderPrice = screenRadius >= (options.isMobile ? 28 : 22);
  const canRenderMovement = screenRadius >= (options.isMobile ? 42 : 34);
  const glowRadius = safeRadius(radius * (isHovered ? 1.2 : node.isTrending ? 1.12 : 1.06), radius);

  ctx.save();
  ctx.globalAlpha = easeIntro;

  const glow = ctx.createRadialGradient(x, y, safeRadius(radius * 0.86), x, y, glowRadius);
  glow.addColorStop(0, isHovered ? node.glowColor : "rgba(255,255,255,0.02)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
  ctx.fill();

  const fill = ctx.createRadialGradient(x - radius * 0.25, y - radius * 0.34, safeRadius(radius * 0.12), x, y, radius);
  fill.addColorStop(0, `${node.primaryColor}66`);
  fill.addColorStop(0.48, "#18181b");
  fill.addColorStop(1, "#030303");
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.lineWidth = Math.max(3, radius * 0.08);
  ctx.strokeStyle = node.primaryColor;
  ctx.beginPath();
  ctx.arc(x, y, safeRadius(radius - ctx.lineWidth / 2), 0, Math.PI * 2);
  ctx.stroke();

  ctx.lineWidth = Math.max(1, radius * 0.025);
  ctx.strokeStyle = node.secondaryColor;
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
    ctx.lineWidth = Math.max(2, radius * 0.035);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
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
  const [introStartedAt] = useState(() => Date.now());
  const [selectedMarket, setSelectedMarket] = useState<MarketBubbleNode | null>(null);
  const [hoveredMarket, setHoveredMarket] = useState<MarketBubbleNode | null>(null);
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const [dimensions, setDimensions] = useState({ width: 1200, height: 680 });

  const nodes = useMemo(() => markets.map((market, index) => marketToBubbleNode(market, index)), [markets]);
  const particles = useMemo(() => createBackgroundParticles(), []);
  const isMobile = dimensions.width < 640;
  const layoutNodes = useMemo(() => layoutBubbleNodes(nodes, dimensions.width, dimensions.height, isMobile), [dimensions.height, dimensions.width, isMobile, nodes]);

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

    const drawFrame = () => {
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      drawBackground(context, particles);
      const hoveredId = hoveredMarket?.id;
      for (const node of layoutNodes) {
        if (node.id !== hoveredId) drawBubble(node, context, 1, { hoveredId, introStartedAt, isMobile });
      }
      const hoveredNode = hoveredId ? layoutNodes.find((node) => node.id === hoveredId) : null;
      if (hoveredNode) drawBubble(hoveredNode, context, 1, { hoveredId, introStartedAt, isMobile, priorityPass: true });
      frameRef.current = window.requestAnimationFrame(drawFrame);
    };

    drawFrame();
    return () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [dimensions.height, dimensions.width, hoveredMarket?.id, introStartedAt, isMobile, layoutNodes, particles]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedMarket(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const findNodeAtPoint = useCallback(
    (x: number, y: number) => {
      let bestNode: MarketBubbleNode | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const node of layoutNodes) {
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
    [layoutNodes],
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
      if (node) setSelectedMarket(node);
    },
    [findNodeAtPoint],
  );

  return (
    <div
      aria-label={`${layoutNodes.length} sports market bubble map`}
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

      {layoutNodes.length === 0 && !isLoading ? (
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
        <aside className="absolute inset-x-0 bottom-0 z-30 max-h-[72%] overflow-y-auto border-t border-slate-700 bg-slate-950/95 p-4 shadow-2xl backdrop-blur md:inset-x-auto md:bottom-0 md:right-0 md:top-0 md:h-full md:w-96 md:max-h-none md:border-l md:border-t-0">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{selectedMarket.sport}</p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-50">{selectedMarket.title}</h2>
            </div>
            <Button aria-label="Close market details" onClick={() => setSelectedMarket(null)} size="icon" type="button" variant="ghost">
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-md border border-slate-800 bg-slate-900/70 p-3">
              <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Volume</p>
              <p className="mt-1 font-semibold text-slate-100">{money(selectedMarket.volume)}</p>
            </div>
            <div className="rounded-md border border-slate-800 bg-slate-900/70 p-3">
              <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Liquidity</p>
              <p className="mt-1 font-semibold text-slate-100">{money(selectedMarket.liquidity)}</p>
            </div>
            <div className="rounded-md border border-slate-800 bg-slate-900/70 p-3 col-span-2">
              <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Favored</p>
              <p className="mt-1 font-semibold text-slate-100">
                {selectedMarket.favoredOutcome} {formatCents(selectedMarket.favoredPrice)}
              </p>
            </div>
          </div>

          <div className="mt-4 rounded-md border border-slate-800 bg-slate-900/70 p-3">
            <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Outcomes</p>
            <div className="mt-3 space-y-2">
              {selectedMarket.outcomes.map((outcome) => (
                <div key={`${selectedMarket.id}-${outcome.name}`} className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate text-slate-200">{outcome.name}</span>
                  <span className="font-semibold text-slate-50">{formatCents(outcome.price)}</span>
                </div>
              ))}
            </div>
          </div>

          <p className="mt-4 text-sm text-slate-400">Momentum glow: {pct(selectedMarket.priceChange)}</p>

          {selectedMarket.tradeUrl ? (
            <Link
              className="mt-5 inline-flex h-9 items-center justify-center rounded-md bg-cyan-400 px-4 text-sm font-medium text-slate-950 transition hover:bg-cyan-300"
              href={selectedMarket.tradeUrl}
            >
              Trade market
            </Link>
          ) : null}
          {selectedMarket.marketUrl ? (
            <Link className="ml-3 mt-5 inline-flex h-9 items-center justify-center rounded-md border border-slate-700 px-4 text-sm font-medium text-slate-100 transition hover:bg-slate-900" href={selectedMarket.marketUrl}>
              Open details
            </Link>
          ) : null}
        </aside>
      ) : null}
    </div>
  );
}
