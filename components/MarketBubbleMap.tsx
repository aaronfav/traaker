"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type RefAttributes } from "react";
import { forceCollide, forceX, forceY } from "d3-force";
import { Button } from "@/components/ui/button";
import { findTeamStyle, marketBubbleRadius, momentumGlowColor } from "@/lib/sports/teamStyles";
import type { TerminalMarket } from "@/lib/polymarket/types";
import type { ForceGraphMethods, ForceGraphProps, NodeObject } from "react-force-graph-2d";

type ForceGraphComponent = (
  props: ForceGraphProps<MarketBubbleNode, object> & RefAttributes<ForceGraphMethods<MarketBubbleNode, object>>,
) => ReactElement;

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false }) as unknown as ForceGraphComponent;

export type MarketBubbleNode = {
  id: string;
  name: string;
  title: string;
  sport: string;
  teamKey?: string;
  volume: number;
  liquidity: number;
  priceChange: number;
  yesPrice?: number;
  noPrice?: number;
  marketUrl?: string;
  logoUrl?: string;
  primaryColor: string;
  secondaryColor: string;
  glowColor: string;
  label: string;
  ticker: string;
  trendScore: number;
  isTrending: boolean;
  driftPhase: number;
  val: number;
  x?: number;
  y?: number;
};

type BackgroundParticle = {
  x: number;
  y: number;
  size: number;
  phase: number;
  speed: number;
};

const textStopWords = new Set(["will", "the", "market", "moneyline", "winner", "win", "to", "yes", "no", "vs", "v", "at"]);

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

const compactTeamWord = (word?: string) => {
  if (!word) return "";
  return word.length <= 7 ? word.toUpperCase() : word.slice(0, 5).toUpperCase();
};

const shortName = (title: string) => {
  const cleaned = title.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 22) return cleaned;
  return `${cleaned.slice(0, 19).trim()}...`;
};

const makeTicker = (title: string) => {
  const cleaned = title.replace(/[^\w\s/-]/g, " ").replace(/\s+/g, " ").trim();
  const matchup = cleaned.split(/\s+(?:vs|v|at)\s+/i).filter(Boolean);
  if (matchup.length >= 2) {
    return matchup
      .slice(0, 2)
      .map((side) => compactTeamWord(side.split(/\s+/).filter(Boolean).at(-1)))
      .filter(Boolean)
      .join("/");
  }
  const words = cleaned
    .split(/\s+/)
    .filter((word) => word.length > 1 && !textStopWords.has(word.toLowerCase()))
    .slice(0, 2);
  if (words.length === 0) return "TM";
  return words.map((word) => word.slice(0, 5).toUpperCase()).join(" ");
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

const sportCluster = (sport: string) => {
  const normalized = sport.toLowerCase();
  if (normalized.includes("nba") || normalized.includes("basketball") || normalized.includes("wnba")) return { x: -300, y: -125 };
  if (normalized.includes("nfl") || normalized.includes("football")) return { x: 0, y: -160 };
  if (normalized.includes("soccer") || normalized.includes("premier") || normalized.includes("champions")) return { x: 305, y: -105 };
  if (normalized.includes("ufc") || normalized.includes("mma") || normalized.includes("boxing")) return { x: -260, y: 145 };
  if (normalized.includes("tennis") || normalized.includes("golf")) return { x: 230, y: 150 };
  if (normalized.includes("mlb") || normalized.includes("baseball") || normalized.includes("nhl") || normalized.includes("hockey")) return { x: 0, y: 130 };
  return { x: 0, y: 0 };
};

const seededPosition = (id: string, sport: string) => {
  const cluster = sportCluster(sport);
  const hash = hashString(id);
  const angle = ((hash % 360) * Math.PI) / 180;
  const distance = 50 + (hash % 120);
  return {
    x: cluster.x + Math.cos(angle) * distance,
    y: cluster.y + Math.sin(angle) * distance,
  };
};

const trendScoreForMarket = (market: TerminalMarket, volume: number) =>
  Math.abs(market.priceMove24h) * 125 + Math.max(0, market.volumeAcceleration) * 2 + market.recentTradesCount / 8 + Math.log10(volume + 1);

function createBackgroundParticles(count = 95): BackgroundParticle[] {
  return Array.from({ length: count }, (_, index) => {
    const hash = hashString(`particle-${index}`);
    return {
      x: (hash % 1000) / 1000,
      y: (Math.floor(hash / 1000) % 1000) / 1000,
      size: 0.45 + (hash % 11) / 10,
      phase: (hash % 628) / 100,
      speed: 0.35 + (hash % 9) / 20,
    };
  });
}

export function marketToBubbleNode(market: TerminalMarket): MarketBubbleNode {
  const volume = Number.isFinite(market.volume) ? market.volume : market.volume24h;
  const style = findTeamStyle(market.title, `${market.sport} ${market.league}`);
  const val = marketBubbleRadius(volume);
  const trendScore = trendScoreForMarket(market, volume);
  const position = seededPosition(market.id, `${market.sport} ${market.league}`);

  return {
    id: market.id,
    name: shortName(market.title),
    title: market.title,
    sport: market.league || market.sport,
    volume,
    liquidity: market.liquidity,
    priceChange: market.priceMove24h,
    yesPrice: market.yesPrice,
    noPrice: market.noPrice,
    marketUrl: `/markets/${market.id}`,
    logoUrl: style.logoUrl,
    primaryColor: style.primary,
    secondaryColor: style.secondary,
    glowColor: momentumGlowColor(market.priceMove24h, volume),
    label: shortName(market.title).toUpperCase(),
    ticker: makeTicker(market.title),
    trendScore,
    isTrending: trendScore >= 10 || Math.abs(market.priceMove24h) >= 0.05 || market.recentTradesCount >= 40 || market.volumeAcceleration >= 1.5,
    driftPhase: (hashString(market.id) % 628) / 100,
    val,
    ...position,
  };
}

function drawBackground(ctx: CanvasRenderingContext2D, particles: BackgroundParticle[]) {
  const now = Date.now() / 1000;
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;

  ctx.save();
  ctx.resetTransform();

  const background = ctx.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, "#020617");
  background.addColorStop(0.44, "#07111f");
  background.addColorStop(1, "#020617");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  const hazeOne = ctx.createRadialGradient(width * 0.24, height * 0.22, 0, width * 0.24, height * 0.22, width * 0.58);
  hazeOne.addColorStop(0, "rgba(14, 165, 233, 0.13)");
  hazeOne.addColorStop(1, "rgba(14, 165, 233, 0)");
  ctx.fillStyle = hazeOne;
  ctx.fillRect(0, 0, width, height);

  const hazeTwoX = width * (0.72 + Math.sin(now * 0.08) * 0.035);
  const hazeTwoY = height * (0.65 + Math.cos(now * 0.07) * 0.04);
  const hazeTwo = ctx.createRadialGradient(hazeTwoX, hazeTwoY, 0, hazeTwoX, hazeTwoY, width * 0.5);
  hazeTwo.addColorStop(0, "rgba(251, 191, 36, 0.08)");
  hazeTwo.addColorStop(1, "rgba(251, 191, 36, 0)");
  ctx.fillStyle = hazeTwo;
  ctx.fillRect(0, 0, width, height);

  for (const particle of particles) {
    const x = ((particle.x * width + Math.sin(now * particle.speed + particle.phase) * 10) % width) + 0.5;
    const y = ((particle.y * height + Math.cos(now * particle.speed * 0.7 + particle.phase) * 8) % height) + 0.5;
    const alpha = 0.14 + Math.sin(now * particle.speed + particle.phase) * 0.08;
    ctx.fillStyle = `rgba(203, 213, 225, ${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, particle.size, 0, Math.PI * 2);
    ctx.fill();
  }

  const vignette = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.18, width / 2, height / 2, Math.max(width, height) * 0.72);
  vignette.addColorStop(0, "rgba(2, 6, 23, 0)");
  vignette.addColorStop(1, "rgba(2, 6, 23, 0.74)");
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
  const logoSize = radius * 0.72;

  ctx.save();
  ctx.globalAlpha *= opacity;
  if (logo?.complete && logo.naturalWidth > 0) {
    ctx.beginPath();
    ctx.arc(x, y, logoSize / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(logo, x - logoSize / 2, y - logoSize / 2, logoSize, logoSize);
  } else {
    const darkText = node.primaryColor.toLowerCase() === "#ffffff";
    ctx.fillStyle = darkText ? "#0f172a" : "#ffffff";
    ctx.font = `900 ${Math.max(12, radius * 0.34)}px Inter, ui-sans-serif, system-ui, sans-serif`;
    drawTextLine(ctx, node.ticker.split("/").map((part) => part[0]).join("") || "TM", x, y - radius * 0.02, radius * 0.95);
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
  const hoverBoost = isHovered ? 1.09 : 1;
  const pulse = node.isTrending ? 1 + Math.sin(now / 520 + node.driftPhase) * 0.045 : 1;
  const radius = node.val * hoverBoost * pulse * (0.82 + easeIntro * 0.18);
  const driftStrength = options.isMobile ? 0.8 : 1.75;
  const x = (node.x ?? 0) + Math.sin(now / 2300 + node.driftPhase) * driftStrength;
  const y = (node.y ?? 0) + Math.cos(now / 2700 + node.driftPhase * 1.2) * driftStrength;
  const screenRadius = radius / globalScale;
  const canRenderText = screenRadius >= (options.isMobile ? 32 : 24);
  const renderFullText = screenRadius > (options.isMobile ? 48 : 38);
  const glowRadius = radius * (isHovered ? 1.72 : node.isTrending ? 1.52 : 1.36);

  ctx.save();
  ctx.globalAlpha = easeIntro;

  const glow = ctx.createRadialGradient(x, y, radius * 0.72, x, y, glowRadius);
  glow.addColorStop(0, node.isTrending ? "rgba(251, 191, 36, 0.34)" : node.glowColor.replace("0.85", "0.28").replace("0.72", "0.24").replace("0.92", "0.34"));
  glow.addColorStop(0.5, isHovered ? node.glowColor : "rgba(15, 23, 42, 0.02)");
  glow.addColorStop(1, "rgba(15, 23, 42, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
  ctx.shadowBlur = radius * 0.28;
  ctx.shadowOffsetY = radius * 0.12;

  const fill = ctx.createRadialGradient(x - radius * 0.28, y - radius * 0.36, radius * 0.12, x, y, radius);
  fill.addColorStop(0, "rgba(255, 255, 255, 0.72)");
  fill.addColorStop(0.18, `${node.primaryColor}f2`);
  fill.addColorStop(0.72, `${node.primaryColor}c8`);
  fill.addColorStop(1, "rgba(15, 23, 42, 0.72)");
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  ctx.lineWidth = Math.max(2.2, radius * 0.055);
  ctx.strokeStyle = node.secondaryColor;
  ctx.beginPath();
  ctx.arc(x, y, radius - ctx.lineWidth / 2, 0, Math.PI * 2);
  ctx.stroke();

  ctx.lineWidth = Math.max(1.2, radius * 0.025);
  ctx.strokeStyle = isHovered ? "rgba(255, 255, 255, 0.72)" : "rgba(255, 255, 255, 0.32)";
  ctx.beginPath();
  ctx.arc(x, y, radius * 0.88, Math.PI * 1.08, Math.PI * 1.72);
  ctx.stroke();

  ctx.lineWidth = Math.max(1.2, radius * 0.026);
  ctx.strokeStyle = node.isTrending ? "rgba(251, 191, 36, 0.72)" : node.glowColor;
  ctx.beginPath();
  ctx.arc(x, y, radius * 0.96, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = "rgba(255,255,255,0.24)";
  ctx.beginPath();
  ctx.ellipse(x - radius * 0.22, y - radius * 0.36, radius * 0.36, radius * 0.13, -0.48, 0, Math.PI * 2);
  ctx.fill();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  if (canRenderText) {
    const darkText = node.primaryColor.toLowerCase() === "#ffffff";
    const mainTextColor = darkText ? "#0f172a" : "#f8fafc";

    if (renderFullText) {
      drawLogoMark(node, ctx, x, y - radius * 0.38, radius, 0.46);

      ctx.fillStyle = mainTextColor;
      ctx.font = `800 ${Math.max(10, radius * 0.21)}px Inter, ui-sans-serif, system-ui, sans-serif`;
      drawTextLine(ctx, node.label, x, y - radius * 0.05, radius * 1.5);

      ctx.fillStyle = node.priceChange >= 0 ? "#bbf7d0" : "#fecdd3";
      ctx.font = `800 ${Math.max(10, radius * 0.2)}px Inter, ui-sans-serif, system-ui, sans-serif`;
      drawTextLine(ctx, pct(node.priceChange), x, y + radius * 0.24, radius * 1.3);

      ctx.fillStyle = "#e0f2fe";
      ctx.font = `700 ${Math.max(9, radius * 0.16)}px Inter, ui-sans-serif, system-ui, sans-serif`;
      drawTextLine(ctx, money(node.volume), x, y + radius * 0.5, radius * 1.2);
    } else {
      drawLogoMark(node, ctx, x, y - radius * 0.18, radius, 0.85);
      ctx.fillStyle = mainTextColor;
      ctx.font = `800 ${Math.max(9, radius * 0.24)}px Inter, ui-sans-serif, system-ui, sans-serif`;
      drawTextLine(ctx, node.ticker, x, y + radius * 0.28, radius * 1.15);
    }
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
  onLoadMore,
  hasMore = false,
}: {
  markets: TerminalMarket[];
  isLoading?: boolean;
  isRefreshing?: boolean;
  onLoadMore?: () => void;
  hasMore?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<ForceGraphMethods<MarketBubbleNode, object> | null>(null);
  const hasFitInitialGraph = useRef(false);
  const [introStartedAt] = useState(() => Date.now());
  const [selectedMarket, setSelectedMarket] = useState<MarketBubbleNode | null>(null);
  const [hoveredMarket, setHoveredMarket] = useState<MarketBubbleNode | null>(null);
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const [dimensions, setDimensions] = useState({ width: 1200, height: 680 });

  const nodes = useMemo(() => markets.map(marketToBubbleNode), [markets]);
  const graphData = useMemo(() => ({ nodes, links: [] }), [nodes]);
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
    graph.d3Force("collide", forceCollide<NodeObject<MarketBubbleNode>>((node) => node.val + 10).strength(1));
    graph.d3Force("charge")?.strength?.(-12);
    graph.d3Force("clusterX", forceX<NodeObject<MarketBubbleNode>>((node) => sportCluster(node.sport).x).strength(0.045));
    graph.d3Force("clusterY", forceY<NodeObject<MarketBubbleNode>>((node) => sportCluster(node.sport).y).strength(0.04));
    graph.d3Force("center");
    graph.d3ReheatSimulation();
    if (!hasFitInitialGraph.current) {
      hasFitInitialGraph.current = true;
      window.setTimeout(() => graph.zoomToFit?.(900, isMobile ? 28 : 62), 180);
    }
  }, [isMobile, nodes]);

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
    graph?.centerAt?.(0, 0, 650);
    graph?.zoom?.(1, 650);
  }, []);

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
      className="relative h-[calc(100vh-8.8rem)] min-h-[460px] overflow-hidden rounded-lg border border-slate-800 bg-slate-950 shadow-2xl shadow-cyan-950/20 sm:h-[calc(100vh-7.6rem)]"
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
          backgroundColor="#020617"
          cooldownTicks={150}
          d3AlphaDecay={0.015}
          d3VelocityDecay={0.28}
          enableNodeDrag
          enablePanInteraction
          enablePointerInteraction
          enableZoomInteraction
          linkVisibility={false}
          maxZoom={4.2}
          minZoom={0.45}
          nodeCanvasObject={drawNode}
          nodeId="id"
          nodeLabel={(node) => `${node.title} | ${money(node.volume)} volume | ${pct(node.priceChange)} movement`}
          nodePointerAreaPaint={(node, color, ctx) => {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(node.x ?? 0, node.y ?? 0, node.val + 12, 0, Math.PI * 2);
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
            <span>Liquidity</span>
            <span className="text-right text-slate-100">{money(hoveredMarket.liquidity)}</span>
            <span>Odds</span>
            <span className="text-right text-slate-100">
              {hoveredMarket.yesPrice != null ? `${(hoveredMarket.yesPrice * 100).toFixed(1)}c` : "N/A"}
            </span>
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

      {hasMore && onLoadMore ? (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2">
          <Button onClick={onLoadMore} size="sm" type="button" variant="secondary">
            Load more bubbles
          </Button>
        </div>
      ) : null}

      {nodes.length === 0 && !isLoading ? (
        <div className="absolute inset-0 grid place-items-center text-sm text-slate-400">No sports markets matched this view.</div>
      ) : null}

      {selectedMarket ? (
        <aside className="absolute inset-x-0 bottom-0 max-h-[72%] overflow-y-auto border-t border-slate-700 bg-slate-950/95 p-4 shadow-2xl backdrop-blur md:inset-x-auto md:bottom-0 md:right-0 md:top-0 md:h-full md:w-96 md:max-h-none md:border-l md:border-t-0">
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
            <div className="rounded-md border border-slate-800 bg-slate-900/70 p-3">
              <p className="text-xs uppercase tracking-[0.16em] text-slate-500">YES</p>
              <p className="mt-1 font-semibold text-slate-100">{selectedMarket.yesPrice != null ? `${(selectedMarket.yesPrice * 100).toFixed(1)}c` : "N/A"}</p>
            </div>
            <div className="rounded-md border border-slate-800 bg-slate-900/70 p-3">
              <p className="text-xs uppercase tracking-[0.16em] text-slate-500">NO</p>
              <p className="mt-1 font-semibold text-slate-100">{selectedMarket.noPrice != null ? `${(selectedMarket.noPrice * 100).toFixed(1)}c` : "N/A"}</p>
            </div>
          </div>

          <p className="mt-4 text-sm text-slate-400">Momentum glow: {pct(selectedMarket.priceChange)}</p>

          {selectedMarket.marketUrl ? (
            <Link
              className="mt-5 inline-flex h-9 items-center justify-center rounded-md bg-cyan-400 px-4 text-sm font-medium text-slate-950 transition hover:bg-cyan-300"
              href={selectedMarket.marketUrl}
            >
              Open market
            </Link>
          ) : null}
        </aside>
      ) : null}
    </div>
  );
}
