"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type RefAttributes } from "react";
import { forceCollide, forceX, forceY } from "d3-force";
import { Button } from "@/components/ui/button";
import { findTeamStyleMatch, marketBubbleRadius, momentumGlowColor } from "@/lib/sports/teamStyles";
import type { TerminalMarket } from "@/lib/polymarket/types";
import type { ForceGraphMethods, ForceGraphProps, NodeObject } from "react-force-graph-2d";

type ForceGraphComponent = (
  props: ForceGraphProps<MarketBubbleNode, object> & RefAttributes<ForceGraphMethods<MarketBubbleNode, object>>,
) => ReactElement;

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false }) as unknown as ForceGraphComponent;

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
  x?: number;
  y?: number;
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

export const formatCents = (price: number) => `${Math.round(Math.max(0, Math.min(1, price)) * 100)}\u00a2`;

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
  if (index < 5) return Math.max(90, Math.min(115, baseRadius + 8));
  if (index < 20) return Math.max(60, Math.min(85, baseRadius - 10));
  return Math.max(42, Math.min(58, baseRadius - 24));
};

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
  Math.abs(market.priceMove24h) * 125 + Math.max(0, market.volumeAcceleration) * 2 + market.recentTradesCount / 8 + Math.log10(volume + 1);

export function getMarketOutcomes(market: RawOutcomeMarket): MarketOutcomeOption[] {
  const arrayOutcomes = parseStringArray(market.outcomes);
  const rawPrices = parseNumberArray(market.outcomePrices);
  const names = arrayOutcomes.length > 0 ? arrayOutcomes : [market.outcomes.yes, market.outcomes.no];
  const prices = rawPrices.length >= names.length ? rawPrices : [market.yesPrice, market.noPrice];
  return names.map((name, index) => {
    const price = Number.isFinite(prices[index]) ? Math.max(0, Math.min(1, prices[index])) : 0;
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
  if (market.priceMove24h > 0.005) return { primary: "#16C784", secondary: "#7CFFB2" };
  if (market.priceMove24h < -0.005) return { primary: "#EA3943", secondary: "#FF7A84" };
  return { primary: "#3A3F47", secondary: "#9AA4B2" };
}

export function marketToBubbleNode(market: TerminalMarket, index = 0): MarketBubbleNode {
  const volume = Number.isFinite(market.volume) ? market.volume : market.volume24h;
  const sizeBasis = Math.max(volume, market.liquidity);
  const favored = getFavoredOutcome(market);
  const outcomes = getMarketOutcomes(market);
  const style = marketColors(market, favored.name);
  const val = rankBubbleRadius(marketBubbleRadius(sizeBasis), index);
  const trendScore = trendScoreForMarket(market, volume);
  const position = seededPosition(market.id);

  return {
    id: market.id,
    title: market.title,
    sport: market.league || market.sport,
    volume,
    liquidity: market.liquidity,
    priceChange: market.priceMove24h,
    marketUrl: `/markets/${market.id}`,
    tradeUrl: `/trade/${market.id}`,
    logoUrl: style.logoUrl ?? market.image,
    primaryColor: style.primary,
    secondaryColor: style.secondary,
    glowColor: momentumGlowColor(market.priceMove24h, volume),
    favoredOutcome: compactOutcomeName(favored.name),
    favoredPrice: favored.price,
    priceCents: favored.priceCents,
    outcomes,
    trendScore,
    isTrending: trendScore >= 10 || Math.abs(market.priceMove24h) >= 0.05 || market.recentTradesCount >= 40 || market.volumeAcceleration >= 1.5,
    driftPhase: (hashString(market.id) % 628) / 100,
    val,
    targetX: position.x,
    targetY: position.y,
    ...position,
  };
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
    ctx.arc(particle.x * width, particle.y * height, particle.size, 0, Math.PI * 2);
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

function drawLogoMark(node: NodeObject<MarketBubbleNode>, ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, opacity: number) {
  const logo = getLogoImage(node.logoUrl);
  const logoSize = radius * 0.38;

  ctx.save();
  ctx.globalAlpha *= opacity;
  if (logo?.complete && logo.naturalWidth > 0) {
    ctx.beginPath();
    ctx.arc(x, y, logoSize / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(logo, x - logoSize / 2, y - logoSize / 2, logoSize, logoSize);
  } else {
    const initials = initialsForName(node.favoredOutcome);
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = Math.max(1.2, radius * 0.02);
    ctx.beginPath();
    ctx.arc(x, y, logoSize * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (initials) {
      ctx.fillStyle = "rgba(255,255,255,0.78)";
      ctx.font = `900 ${Math.max(9, radius * 0.14)}px Inter, ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(initials, x, y + 0.5, logoSize * 0.7);
    }
  }
  ctx.restore();
}

function drawBubble(
  node: NodeObject<MarketBubbleNode>,
  ctx: CanvasRenderingContext2D,
  globalScale: number,
  options: { hoveredId?: string | null; introStartedAt: number; isMobile: boolean; priorityPass?: boolean },
) {
  const now = Date.now();
  const introAlpha = Math.min(1, Math.max(0, (now - options.introStartedAt) / 900));
  const easeIntro = 1 - Math.pow(1 - introAlpha, 3);
  const isHovered = node.id === options.hoveredId;
  const hoverBoost = isHovered ? 1.06 : 1;
  const pulse = node.isTrending ? 1 + Math.sin(now / 900 + node.driftPhase) * 0.025 : 1;
  const radius = node.val * hoverBoost * pulse;
  const driftStrength = options.isMobile ? 0.25 : 0.55;
  const x = (node.x ?? 0) + Math.sin(now / 5200 + node.driftPhase) * driftStrength;
  const y = (node.y ?? 0) + Math.cos(now / 6100 + node.driftPhase * 1.2) * driftStrength;
  const screenRadius = radius / globalScale;
  const canRenderText = screenRadius >= (options.isMobile ? 24 : 18);
  const canRenderPrice = screenRadius >= (options.isMobile ? 28 : 22);
  const canRenderMovement = screenRadius >= (options.isMobile ? 42 : 34);
  const glowRadius = radius * (isHovered ? 1.2 : node.isTrending ? 1.12 : 1.06);

  ctx.save();
  ctx.globalAlpha = easeIntro;

  const glow = ctx.createRadialGradient(x, y, radius * 0.86, x, y, glowRadius);
  glow.addColorStop(0, isHovered ? node.glowColor : "rgba(255,255,255,0.02)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
  ctx.fill();

  const fill = ctx.createRadialGradient(x - radius * 0.25, y - radius * 0.34, radius * 0.12, x, y, radius);
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
  ctx.arc(x, y, radius - ctx.lineWidth / 2, 0, Math.PI * 2);
  ctx.stroke();

  ctx.lineWidth = Math.max(1, radius * 0.025);
  ctx.strokeStyle = node.secondaryColor;
  ctx.beginPath();
  ctx.arc(x, y, radius - Math.max(4, radius * 0.1), 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = Math.max(1, radius * 0.018);
  ctx.beginPath();
  ctx.arc(x, y, radius * 0.82, Math.PI * 1.08, Math.PI * 1.85);
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
    ctx.arc(x, y, radius + 1.5, 0, Math.PI * 2);
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
  const graphRef = useRef<ForceGraphMethods<MarketBubbleNode, object> | null>(null);
  const lastFitNodeCount = useRef(0);
  const lastLayoutSignature = useRef("");
  const [introStartedAt] = useState(() => Date.now());
  const [selectedMarket, setSelectedMarket] = useState<MarketBubbleNode | null>(null);
  const [hoveredMarket, setHoveredMarket] = useState<MarketBubbleNode | null>(null);
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const [dimensions, setDimensions] = useState({ width: 1200, height: 680 });

  const nodes = useMemo(() => markets.map((market, index) => marketToBubbleNode(market, index)), [markets]);
  const graphData = useMemo(() => ({ nodes, links: [] }), [nodes]);
  const layoutSignature = useMemo(() => nodes.map((node) => node.id).join("|"), [nodes]);
  const particles = useMemo(() => createBackgroundParticles(), []);
  const isMobile = dimensions.width < 640;

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
    const graph = graphRef.current;
    if (!graph || typeof graph.d3Force !== "function" || nodes.length === 0) return;
    graph.d3Force("collide", forceCollide<NodeObject<MarketBubbleNode>>((node) => node.val + (isMobile ? 6 : 8)).strength(1));
    graph.d3Force("charge")?.strength?.(isMobile ? -6 : -10);
    graph.d3Force("clusterX", forceX<NodeObject<MarketBubbleNode>>((node) => node.targetX).strength(0.018));
    graph.d3Force("clusterY", forceY<NodeObject<MarketBubbleNode>>((node) => node.targetY).strength(0.018));
    graph.d3Force("center");
    if (lastLayoutSignature.current !== layoutSignature) {
      lastLayoutSignature.current = layoutSignature;
      graph.d3ReheatSimulation();
    }
    if (lastFitNodeCount.current === 0 || Math.abs(nodes.length - lastFitNodeCount.current) >= 10) {
      lastFitNodeCount.current = nodes.length;
      window.setTimeout(() => graph.zoomToFit?.(900, isMobile ? 8 : 12), 360);
    }
  }, [isMobile, layoutSignature, nodes.length]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedMarket(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleNodeClick = useCallback((node: NodeObject<MarketBubbleNode>) => {
    setSelectedMarket(node);
  }, []);

  const handleMouseMove = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setPointer({ x: event.clientX - rect.left, y: event.clientY - rect.top });
  }, []);

  const handleCenterMap = useCallback(() => {
    const graph = graphRef.current;
    graph?.zoomToFit?.(650, isMobile ? 8 : 12);
  }, [isMobile]);

  const drawNode = useCallback(
    (node: NodeObject<MarketBubbleNode>, ctx: CanvasRenderingContext2D, globalScale: number) => {
      drawBubble(node, ctx, globalScale, { hoveredId: hoveredMarket?.id, introStartedAt, isMobile });
    },
    [hoveredMarket?.id, introStartedAt, isMobile],
  );

  const drawHoveredNode = useCallback(
    (ctx: CanvasRenderingContext2D, globalScale: number) => {
      if (hoveredMarket) drawBubble(hoveredMarket, ctx, globalScale, { hoveredId: hoveredMarket.id, introStartedAt, isMobile, priorityPass: true });
    },
    [hoveredMarket, introStartedAt, isMobile],
  );

  const drawMapBackground = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      drawBackground(ctx, particles);
    },
    [particles],
  );

  return (
    <div
      aria-label={`${nodes.length} sports market bubble map`}
      className="relative h-[calc(100vh-5.45rem)] min-h-[480px] w-screen overflow-hidden bg-[#050505] sm:h-[calc(100vh-5.15rem)]"
      onDoubleClick={handleCenterMap}
      onMouseMove={handleMouseMove}
      role="application"
    >
      <div ref={containerRef} className="h-full w-full">
        <ForceGraph2D
          ref={graphRef}
          graphData={graphData}
          width={dimensions.width}
          height={dimensions.height}
          autoPauseRedraw={false}
          backgroundColor="#050505"
          cooldownTicks={220}
          d3AlphaDecay={0.04}
          d3VelocityDecay={0.52}
          enableNodeDrag
          enablePanInteraction
          enablePointerInteraction
          enableZoomInteraction
          linkVisibility={false}
          maxZoom={2.8}
          minZoom={0.08}
          nodeCanvasObject={drawNode}
          nodeId="id"
          nodeLabel={(node) => `${node.favoredOutcome} ${formatCents(node.favoredPrice)} | ${node.title}`}
          nodePointerAreaPaint={(node, color, ctx) => {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(node.x ?? 0, node.y ?? 0, node.val + 6, 0, Math.PI * 2);
            ctx.fill();
          }}
          nodeRelSize={1}
          nodeVal="val"
          onBackgroundClick={() => setHoveredMarket(null)}
          onNodeClick={handleNodeClick}
          onNodeHover={(node) => {
            const canvas = containerRef.current?.querySelector("canvas");
            if (canvas) canvas.style.cursor = node ? "pointer" : "default";
            setHoveredMarket((current) => {
              if (!node) return current ? null : current;
              return current?.id === node.id ? current : node;
            });
          }}
          onRenderFramePost={drawHoveredNode}
          onRenderFramePre={drawMapBackground}
          showPointerCursor
        />
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

      {nodes.length === 0 && !isLoading ? (
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
