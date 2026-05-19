import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MarketBubbleMap, marketToBubbleNode } from "@/components/MarketBubbleMap";
import type { MarketBubbleNode } from "@/components/MarketBubbleMap";
import type { TerminalMarket } from "@/lib/polymarket/types";

type MockForceGraphProps = {
  graphData: { nodes: MarketBubbleNode[] };
  d3AlphaDecay?: number;
  d3VelocityDecay?: number;
  maxZoom?: number;
  minZoom?: number;
  onNodeClick: (node: MarketBubbleNode) => void;
  onNodeHover?: (node: MarketBubbleNode | null, previousNode: MarketBubbleNode | null) => void;
};

type MockForceGraphHandle = {
  d3Force: ReturnType<typeof vi.fn>;
  d3ReheatSimulation: ReturnType<typeof vi.fn>;
};

vi.mock("next/dynamic", async () => {
  const React = await import("react");
  return {
    default: () =>
      React.forwardRef<MockForceGraphHandle, MockForceGraphProps>(function MockForceGraph(props, ref) {
        React.useImperativeHandle(ref, () => ({
          d3Force: vi.fn(() => ({ strength: vi.fn() })),
          d3ReheatSimulation: vi.fn(),
        }));
        const firstNode = props.graphData.nodes[0];
        return (
          <div data-testid="force-graph">
            <span data-testid="graph-config">
              {props.d3VelocityDecay}|{props.d3AlphaDecay}|{props.minZoom}|{props.maxZoom}
            </span>
            <span>{props.graphData.nodes.length} canvas nodes</span>
            {firstNode ? <button onClick={() => props.onNodeClick(firstNode)}>Open first bubble</button> : null}
            {firstNode ? <button onMouseEnter={() => props.onNodeHover?.(firstNode, null)}>Hover first bubble</button> : null}
          </div>
        );
      }),
  };
});

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

describe("MarketBubbleMap", () => {
  it("converts markets into team-colored bubble nodes", () => {
    const node = marketToBubbleNode(market);
    expect(node.primaryColor).toBe("#552583");
    expect(node.secondaryColor).toBe("#FDB927");
    expect(node.ticker).toBe("LAKERS/CELTICS");
    expect(node.val).toBeGreaterThan(100);
    expect(node.val).toBeLessThanOrEqual(110);
    expect(node.marketUrl).toBe("/markets/market-1");
  });

  it("uses calmer graph physics controls", () => {
    render(<MarketBubbleMap markets={[market]} />);

    expect(screen.getByTestId("graph-config")).toHaveTextContent("0.28|0.015|0.45|4.2");
  });

  it("shows a readable hover tooltip", () => {
    render(<MarketBubbleMap markets={[market]} />);

    fireEvent.mouseMove(screen.getByRole("application"), { clientX: 120, clientY: 90 });
    fireEvent.mouseEnter(screen.getByRole("button", { name: "Hover first bubble" }));

    expect(screen.getByText("Liquidity")).toBeInTheDocument();
    expect(screen.getByText("$75.0k")).toBeInTheDocument();
    expect(screen.getByText("+3.0%")).toBeInTheDocument();
  });

  it("opens details when a bubble node is clicked", () => {
    render(<MarketBubbleMap markets={[market]} />);

    fireEvent.click(screen.getByRole("button", { name: "Open first bubble" }));

    expect(screen.getByRole("heading", { name: "Los Angeles Lakers vs Boston Celtics" })).toBeInTheDocument();
    expect(screen.getByText("NBA")).toBeInTheDocument();
    expect(screen.getByText("$250k")).toBeInTheDocument();
    expect(screen.getByText("62.0c")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open market" })).toHaveAttribute("href", "/markets/market-1");
  });
});
