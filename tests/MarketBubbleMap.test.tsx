import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { marketStore } from "@/app/store/marketStore";
import {
  applySmoothedMarketValueToBody,
  cleanOutcomeName,
  createBubbleBodies,
  createBubbleVisualSmoothingState,
  formatCents,
  getFavoredOutcome,
  layoutBubbleNodes,
  MarketBubbleMap,
  marketToBubbleNode,
  mergeBubbleBodies,
  tickBubblePhysics,
  type BubbleBody,
} from "@/components/MarketBubbleMap";
import { MarketTradePanel } from "@/components/MarketTradePanel";
import type { TerminalMarket } from "@/lib/polymarket/types";

function createStrictCanvasContext() {
  const gradient = { addColorStop: vi.fn() };
  return {
    canvas: { width: 800, height: 600 },
    globalAlpha: 1,
    save: vi.fn(),
    restore: vi.fn(),
    resetTransform: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    clip: vi.fn(),
    drawImage: vi.fn(),
    strokeText: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: text.length * 7 })),
    setTransform: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
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
    marketStore.reset();
  });

  it("converts markets into team-colored bubble nodes", () => {
    const node = marketToBubbleNode(market);
    expect(node.primaryColor).toBe("#552583");
    expect(node.secondaryColor).toBe("#FDB927");
    expect(node.logoUrl).toBe("/team-logos/lakers.svg");
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

  it("shows a branded loader while markets are loading", () => {
    render(<MarketBubbleMap isLoading markets={[]} />);

    expect(screen.getByTestId("traak-loader")).toBeInTheDocument();
    expect(screen.getByLabelText("Loading Traak markets")).toBeInTheDocument();
    expect(screen.getByText("Refreshing markets")).toBeInTheDocument();
    expect(screen.queryByText("Loading snapshot")).not.toBeInTheDocument();
    expect(screen.queryByText("Preparing the board")).not.toBeInTheDocument();
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
    expect(screen.getAllByText("Celtics").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /open on polymarket/i })).toHaveAttribute("href", "https://polymarket.com/event/lakers-celtics");
    expect(screen.getByRole("button", { name: "Connect wallet to trade" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Execution disabled" })).toBeDisabled();
  });

  it("closes the trade panel with Escape", () => {
    const [node] = layoutBubbleNodes([marketToBubbleNode(market)], 1200, 680, false);
    render(<MarketBubbleMap markets={[market]} />);

    fireEvent.click(screen.getByRole("application"), { clientX: node.x, clientY: node.y });
    expect(screen.getByRole("heading", { name: "Los Angeles Lakers vs Boston Celtics" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("heading", { name: "Los Angeles Lakers vs Boston Celtics" })).not.toBeInTheDocument();
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

  it("merges live updates without resetting bubble positions", () => {
    const previous = createBubbleBodies([marketToBubbleNode(market)], 1200, 680, false);
    previous[0].x = 321;
    previous[0].y = 222;
    const nextNode = marketToBubbleNode({ ...market, yesPrice: 0.71, priceMove24h: 0.09 });
    const nextBodies = createBubbleBodies([nextNode], 1200, 680, false);

    const [merged] = mergeBubbleBodies(previous, nextBodies, 1200, 680);

    expect(merged.x).toBe(321);
    expect(merged.y).toBe(222);
    expect(merged.favoredPrice).toBe(0.71);
    expect(merged.priceChange).toBe(0.09);
    expect(merged.radius).toBe(previous[0].radius);
  });

  it("freezes bubble displayed price until manual refresh", () => {
    const [body] = createBubbleBodies([marketToBubbleNode(market)], 1200, 680, false);
    const state = createBubbleVisualSmoothingState(body, 1_000);

    const applied = applySmoothedMarketValueToBody(body, { ...market, yesPrice: 0.71, noPrice: 0.29 }, 0, state, undefined, 1_000);

    expect(applied).toBe(false);
    expect(body.favoredPrice).toBe(0.62);
    expect(state.priceTarget).toBe(0.62);
    expect(body.visualPulseDirection).toBeUndefined();
  });

  it("ignores tiny duplicate visual price updates", () => {
    const [body] = createBubbleBodies([marketToBubbleNode(market)], 1200, 680, false);
    const state = createBubbleVisualSmoothingState(body, 1_000);

    const applied = applySmoothedMarketValueToBody(body, { ...market, yesPrice: 0.624, noPrice: 0.376 }, 0, state, undefined, 1_000);

    expect(applied).toBe(false);
    expect(body.favoredPrice).toBe(0.62);
  });

  it("does not switch visible favored outcome from live updates", () => {
    const [body] = createBubbleBodies([marketToBubbleNode(market)], 1200, 680, false);
    const state = createBubbleVisualSmoothingState(body, 10_000);
    const celticsLead = { ...market, yesPrice: 0.49, noPrice: 0.51 };

    applySmoothedMarketValueToBody(body, celticsLead, 0, state, undefined, 10_000);
    expect(body.favoredOutcome).toBe("Lakers");

    applySmoothedMarketValueToBody(body, celticsLead, 0, state, undefined, 11_000);
    expect(body.favoredOutcome).toBe("Lakers");

    applySmoothedMarketValueToBody(body, celticsLead, 0, state, undefined, 20_000);
    expect(body.favoredOutcome).toBe("Lakers");
  });

  it("does not remove a visible bubble when live price leaves the active range", () => {
    const [body] = createBubbleBodies([marketToBubbleNode(market)], 1200, 680, false);
    const state = createBubbleVisualSmoothingState(body, 10_000);

    const applied = applySmoothedMarketValueToBody(body, { ...market, yesPrice: 0.99, noPrice: 0.01 }, 0, state, undefined, 10_000);

    expect(applied).toBe(false);
    expect(body.isLiveHidden).toBe(false);
    expect(body.activeRangeWarning).toBe(true);
    expect(body.favoredPrice).not.toBe(0.99);
  });

  it("live store updates do not remove a rendered bubble crossing 95 cents", () => {
    render(<MarketBubbleMap markets={[market]} />);

    marketStore.setMarketSnapshots([{ ...market, yesPrice: 0.99, noPrice: 0.01 }], { replace: true });

    expect(screen.getByRole("application", { name: /1 sports market bubble map/i })).toBeInTheDocument();
  });

  it("websocket or polling store updates do not change bubble displayed price", () => {
    const [node] = layoutBubbleNodes([marketToBubbleNode(market)], 1200, 680, false);
    render(<MarketBubbleMap markets={[market]} />);

    fireEvent.mouseMove(screen.getByRole("application"), { clientX: node.x, clientY: node.y });
    expect(screen.getByText("Lakers 62\u00a2")).toBeInTheDocument();

    marketStore.applyMarketSnapshots([{ ...market, yesPrice: 0.71, noPrice: 0.29 }]);

    fireEvent.mouseMove(screen.getByRole("application"), { clientX: node.x, clientY: node.y });
    expect(screen.getByText("Lakers 62\u00a2")).toBeInTheDocument();
    expect(screen.queryByText("Lakers 71\u00a2")).not.toBeInTheDocument();
  });

  it("websocket or polling store updates do not change open trade panel prices", () => {
    const [node] = layoutBubbleNodes([marketToBubbleNode(market)], 1200, 680, false);
    render(<MarketBubbleMap markets={[market]} />);

    fireEvent.click(screen.getByRole("application"), { clientX: node.x, clientY: node.y });
    expect(screen.getAllByText("62\u00a2").length).toBeGreaterThan(0);

    marketStore.applyMarketSnapshots([{ ...market, yesPrice: 0.71, noPrice: 0.29 }]);

    expect(screen.getAllByText("62\u00a2").length).toBeGreaterThan(0);
    expect(screen.queryByText("71\u00a2")).not.toBeInTheDocument();
  });

  it("trade panel keeps stable favored highlight and warns when market leaves active range", () => {
    const panelMarket = {
      ...marketToBubbleNode(market),
      activeRangeWarning: true,
      outcomes: [
        { name: "Lakers", price: 0.09, priceCents: 9 },
        { name: "Celtics", price: 0.91, priceCents: 91 },
      ],
    };

    render(<MarketTradePanel market={panelMarket} onClose={vi.fn()} />);

    expect(screen.getByText("Market moved outside active range")).toBeInTheDocument();
    expect(screen.getByText("Favored:").parentElement).toHaveTextContent("Lakers");
    expect(screen.getByRole("button", { name: /lakers/i })).toHaveClass("border-cyan-400");
  });

  it("trade panel keeps selected outcome and row order across price updates", () => {
    const panelMarket = marketToBubbleNode(market);
    const { rerender } = render(<MarketTradePanel market={panelMarket} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /celtics/i }));
    expect(screen.getByRole("button", { name: /celtics/i })).toHaveClass("border-cyan-400");

    rerender(
      <MarketTradePanel
        market={{
          ...panelMarket,
          outcomes: [
            { name: "Lakers", price: 0.59, priceCents: 59 },
            { name: "Celtics", price: 0.41, priceCents: 41 },
          ],
        }}
        onClose={vi.fn()}
      />,
    );

    const lakers = screen.getByRole("button", { name: /lakers/i });
    const celtics = screen.getByRole("button", { name: /celtics/i });
    expect(lakers.compareDocumentPosition(celtics) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(celtics).toHaveClass("border-cyan-400");
  });

  it("refreshes the quote on a 10-second cycle and via the refresh-now icon", async () => {
    vi.useFakeTimers();
    try {
      const panelMarket = marketToBubbleNode(market);
      const onUpdatePrices = vi.fn(async () => marketToBubbleNode({ ...market, yesPrice: 0.71, noPrice: 0.29, bestBid: 0.7, bestAsk: 0.72 }));
      render(<MarketTradePanel market={panelMarket} onClose={vi.fn()} onUpdatePrices={onUpdatePrices} />);

      expect(screen.getAllByText("62\u00a2").length).toBeGreaterThan(0);
      expect(screen.getByText(/live quote/i)).toBeInTheDocument();
      expect(screen.getByText(/updated 0s ago/i)).toBeInTheDocument();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /celtics/i }));
      });
      expect(screen.getByRole("button", { name: /celtics/i })).toHaveClass("border-cyan-400");

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /refresh quote now/i }));
      });

      expect(onUpdatePrices).toHaveBeenCalledTimes(1);
      expect(screen.getAllByText("71\u00a2").length).toBeGreaterThan(0);
      expect(screen.getByRole("button", { name: /celtics/i })).toHaveClass("border-cyan-400");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });

      expect(onUpdatePrices).toHaveBeenCalledTimes(2);
      expect(screen.getAllByText("71\u00a2").length).toBeGreaterThan(0);
      expect(screen.getByRole("button", { name: /celtics/i })).toHaveClass("border-cyan-400");
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows a stale quote when the refresh fails and recovers on a later successful refresh", async () => {
    vi.useFakeTimers();
    try {
      const panelMarket = marketToBubbleNode(market);
      const onUpdatePrices = vi.fn().mockRejectedValueOnce(new Error("network down")).mockResolvedValueOnce(
        marketToBubbleNode({ ...market, yesPrice: 0.71, noPrice: 0.29, bestBid: 0.7, bestAsk: 0.72 }),
      );
      render(<MarketTradePanel market={panelMarket} onClose={vi.fn()} onUpdatePrices={onUpdatePrices} />);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });

      expect(onUpdatePrices).toHaveBeenCalledTimes(1);
      expect(screen.getByText(/quote temporarily unavailable/i)).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000);
      });

      expect(onUpdatePrices).toHaveBeenCalledTimes(2);
      expect(screen.getByText(/live quote/i)).toBeInTheDocument();
      expect(screen.getByText(/updated 0s ago/i)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
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
