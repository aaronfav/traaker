import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanOutcomeName,
  createBubbleBodies,
  formatCents,
  getFavoredOutcome,
  layoutBubbleNodes,
  MarketBubbleMap,
  marketToBubbleNode,
  tickBubblePhysics,
  type BubbleBody,
} from "@/components/MarketBubbleMap";
import type { TerminalMarket } from "@/lib/polymarket/types";

function createStrictCanvasContext() {
  const gradient = { addColorStop: vi.fn() };
  return {
    canvas: { width: 800, height: 600 },
    globalAlpha: 1,
    save: vi.fn(),
    restore: vi.fn(),
    resetTransform: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    clip: vi.fn(),
    drawImage: vi.fn(),
    strokeText: vi.fn(),
    fillText: vi.fn(),
    setTransform: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    ellipse: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    createRadialGradient: vi.fn((_: number, __: number, r0: number, ___: number, ____: number, r1: number) => {
      if (!Number.isFinite(r0) || r0 <= 0 || !Number.isFinite(r1) || r1 <= 0) {
        throw new Error(`Invalid gradient radius ${r0}, ${r1}`);
      }
      return gradient;
    }),
    arc: vi.fn((_: number, __: number, radius: number) => {
      if (!Number.isFinite(radius) || radius <= 0) {
        throw new Error(`Invalid arc radius ${radius}`);
      }
    }),
  } as unknown as CanvasRenderingContext2D;
}

const market: TerminalMarket = {
  id: "market-1",
  conditionId: "condition-1",
  slug: "lakers-celtics",
  title: "Los Angeles Lakers vs Boston Celtics",
  sport: "Basketball",
  league: "NBA",
  status: "live",
  startTime: "2026-06-01T00:00:00Z",
  endTime: "2026-06-01T03:00:00Z",
  yesPrice: 0.62,
  noPrice: 0.38,
  volume24h: 10_000,
  volume: 250_000,
  liquidity: 75_000,
  priceMove24h: 0.03,
  volume1wk: 350_000,
  volumeAcceleration: 1,
  spread: 0.02,
  recentTradesCount: 24,
  opportunityScore: 72,
  outcomes: { yes: "Lakers", no: "Celtics" },
  tokenIds: { yes: "111", no: "222" },
  source: "polymarket",
};

const hasOverlap = (bodies: Array<{ x: number; y: number; radius?: number; val: number }>, padding = 6) =>
  bodies.some((left, leftIndex) =>
    bodies.slice(leftIndex + 1).some((right) => Math.hypot(right.x - left.x, right.y - left.y) < (left.radius ?? left.val) + (right.radius ?? right.val) + padding - 0.01),
  );

describe("MarketBubbleMap", () => {
  beforeEach(() => {
    let frameCount = 0;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(createStrictCanvasContext());
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        frameCount += 1;
        if (frameCount === 1) callback(0);
        return frameCount;
      }),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("converts markets into team-colored bubble nodes", () => {
    const node = marketToBubbleNode(market);
    expect(node.primaryColor).toBe("#552583");
    expect(node.secondaryColor).toBe("#FDB927");
    expect(node.favoredOutcome).toBe("Lakers");
    expect(node.favoredPrice).toBe(0.62);
    expect(node.priceCents).toBe(62);
    expect(node.val).toBeGreaterThanOrEqual(90);
    expect(node.val).toBeLessThanOrEqual(125);
    expect(node.marketUrl).toBe("/markets/market-1");
  });

  it("extracts the favored outcome and formats cents", () => {
    expect(getFavoredOutcome({ ...market, yesPrice: 0.42, noPrice: 0.58 }).name).toBe("Celtics");
    expect(formatCents(0.755)).toBe("76\u00a2");
  });

  it("cleans generic outcome labels into recognizable names", () => {
    expect(cleanOutcomeName("Champion", "Will Oklahoma City Thunder win NBA Finals?")).toBe("Oklahoma City Thunder");
    expect(cleanOutcomeName("Arsenal to win", "Arsenal vs Chelsea")).toBe("Arsenal");
    expect(cleanOutcomeName("Winner", "Real Madrid vs Barcelona")).toBe("Real Madrid");
  });

  it("renders a deterministic canvas board without force graph controls", () => {
    render(<MarketBubbleMap markets={[market]} />);

    expect(screen.getByTestId("bubble-canvas")).toBeInTheDocument();
    expect(screen.queryByTestId("force-graph")).not.toBeInTheDocument();
  });

  it("shows a readable hover tooltip", () => {
    const [node] = layoutBubbleNodes([marketToBubbleNode(market)], 1200, 680, false);
    render(<MarketBubbleMap markets={[market]} />);

    fireEvent.mouseMove(screen.getByRole("application"), { clientX: node.x, clientY: node.y });

    expect(screen.getByText("Liquidity")).toBeInTheDocument();
    expect(screen.getByText("$75.0k")).toBeInTheDocument();
    expect(screen.getByText("Lakers 62\u00a2")).toBeInTheDocument();
    expect(screen.getByText("+3.0%")).toBeInTheDocument();
  });

  it("opens details when a bubble node is clicked", () => {
    const [node] = layoutBubbleNodes([marketToBubbleNode(market)], 1200, 680, false);
    render(<MarketBubbleMap markets={[market]} />);

    fireEvent.click(screen.getByRole("application"), { clientX: node.x, clientY: node.y });

    expect(screen.getByRole("heading", { name: "Los Angeles Lakers vs Boston Celtics" })).toBeInTheDocument();
    expect(screen.getByText("NBA")).toBeInTheDocument();
    expect(screen.getByText("$250k")).toBeInTheDocument();
    expect(screen.getAllByText("62\u00a2").length).toBeGreaterThan(0);
    expect(screen.getByText("Celtics")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Trade market" })).toHaveAttribute("href", "/trade/market-1");
    expect(screen.getByRole("link", { name: "Open details" })).toHaveAttribute("href", "/markets/market-1");
  });

  it("renders invalid tiny node values without negative canvas radii", () => {
    const invalidMarket: TerminalMarket = {
      ...market,
      id: "invalid-node",
      title: "Broken market data",
      yesPrice: Number.NaN,
      noPrice: Number.POSITIVE_INFINITY,
      volume24h: Number.NaN,
      volume: Number.NaN,
      liquidity: Number.NEGATIVE_INFINITY,
      priceMove24h: Number.NaN,
      volumeAcceleration: Number.NaN,
      recentTradesCount: Number.NaN,
      outcomes: { yes: "YES", no: "NO" },
    };
    const node = marketToBubbleNode(invalidMarket);

    expect(node.val).toBeGreaterThanOrEqual(8);
    expect(node.volume).toBe(0);
    expect(node.liquidity).toBe(0);
    expect(node.priceChange).toBe(0);
    expect(() => render(<MarketBubbleMap markets={[invalidMarket]} />)).not.toThrow();
  });

  it("packs default bubbles across the viewport with stable rank sizes", () => {
    const markets = Array.from({ length: 50 }, (_, index) => ({
      ...market,
      id: `market-${index}`,
      conditionId: `condition-${index}`,
      title: `Team ${index} vs Opponent`,
      volume: 1_000_000 - index * 10_000,
      liquidity: 500_000 - index * 5_000,
    }));
    const packed = layoutBubbleNodes(markets.map((item, index) => marketToBubbleNode(item, index)), 1700, 900, false);
    const xs = packed.map((node) => node.x);
    const ys = packed.map((node) => node.y);

    expect(packed).toHaveLength(50);
    expect(packed[0].val).toBeGreaterThanOrEqual(80);
    expect(packed[4].val).toBeLessThanOrEqual(125);
    expect(packed[5].val).toBeGreaterThanOrEqual(58);
    expect(packed[15].val).toBeGreaterThanOrEqual(42);
    expect(packed[36].val).toBeGreaterThanOrEqual(32);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(1250);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(600);
    expect(hasOverlap(packed)).toBe(false);
  });

  it("uses a smaller mobile collision boundary", () => {
    const markets = Array.from({ length: 35 }, (_, index) => ({
      ...market,
      id: `mobile-${index}`,
      conditionId: `mobile-condition-${index}`,
      volume: 800_000 - index * 8_000,
    }));
    const mobileBodies = createBubbleBodies(markets.map((item, index) => marketToBubbleNode(item, index)), 390, 720, true);

    expect(hasOverlap(mobileBodies, 4)).toBe(false);
  });

  it("creates physics bodies inside bounds with fixed radii", () => {
    const markets = Array.from({ length: 50 }, (_, index) => ({
      ...market,
      id: `body-${index}`,
      conditionId: `body-condition-${index}`,
      volume: 1_000_000 - index * 10_000,
    }));
    const bodies = createBubbleBodies(markets.map((item, index) => marketToBubbleNode(item, index)), 1700, 900, false);

    expect(hasOverlap(bodies, 6)).toBe(false);
    for (const body of bodies) {
      expect(body.x - body.radius).toBeGreaterThanOrEqual(0);
      expect(body.x + body.radius).toBeLessThanOrEqual(1700);
      expect(body.y - body.radius).toBeGreaterThanOrEqual(0);
      expect(body.y + body.radius).toBeLessThanOrEqual(900);
      expect(body.mass).toBe(body.radius * body.radius);
    }
  });

  it("collision resolution separates overlapping bubbles and preserves radii", () => {
    const left = { ...marketToBubbleNode(market), id: "left", x: 200, y: 180, val: 50, radius: 50, mass: 2500, vx: 0.1, vy: 0 } satisfies BubbleBody;
    const right = { ...marketToBubbleNode({ ...market, id: "right" }), x: 220, y: 180, val: 50, radius: 50, mass: 2500, vx: -0.1, vy: 0 } satisfies BubbleBody;
    const originalRadii = [left.radius, right.radius];

    tickBubblePhysics([left, right], 500, 400);

    expect(Math.hypot(right.x - left.x, right.y - left.y)).toBeGreaterThanOrEqual(left.radius + right.radius + 6 - 0.01);
    expect([left.radius, right.radius]).toEqual(originalRadii);
  });

  it("physics keeps moving bubbles inside bounds without resizing", () => {
    const body = { ...marketToBubbleNode(market), x: 8, y: 8, val: 40, radius: 40, mass: 1600, vx: -0.2, vy: -0.2 } satisfies BubbleBody;

    tickBubblePhysics([body], 300, 240);

    expect(body.x - body.radius).toBeGreaterThanOrEqual(0);
    expect(body.y - body.radius).toBeGreaterThanOrEqual(0);
    expect(body.radius).toBe(40);
    expect(body.val).toBe(40);
  });
});
