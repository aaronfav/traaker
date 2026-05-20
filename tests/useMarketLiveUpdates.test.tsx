import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { marketStore } from "@/app/store/marketStore";
import { createPolymarketWebSocketController, mergeLiveMarketUpdates, useMarketLiveUpdates } from "@/components/useMarketLiveUpdates";
import type { TerminalMarket } from "@/lib/polymarket/types";

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

describe("useMarketLiveUpdates", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    marketStore.reset();
  });

  it("merges live prices while preserving current market order and ids", () => {
    const merged = mergeLiveMarketUpdates(
      [market, { ...market, id: "market-2", conditionId: "condition-2", yesPrice: 0.51 }],
      [{ ...market, id: "market-1", yesPrice: 0.71, noPrice: 0.29, priceMove24h: 0.09 }],
    );

    expect(merged.map((item) => item.id)).toEqual(["market-1", "market-2"]);
    expect(merged[0].yesPrice).toBe(0.71);
    expect(merged[0].priceMove24h).toBe(0.09);
    expect(merged[1].yesPrice).toBe(0.51);
  });

  it("polls the markets endpoint and reports live status after an update", async () => {
    vi.useFakeTimers();
    const updated = { ...market, yesPrice: 0.68, noPrice: 0.32 };
    const onMarketsUpdate = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ markets: [updated] }), { status: 200 })),
    );

    const { result, unmount } = renderHook(() =>
      useMarketLiveUpdates({
        enabled: true,
        intervalMs: 20,
        onMarketsUpdate,
        requestUrl: "/api/polymarket/markets?limit=250",
      }),
    );

    expect(result.current).toBe("Polling");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });

    expect(onMarketsUpdate).toHaveBeenCalledWith([updated]);
    expect(result.current).toBe("Polling");
    unmount();
  });

  it("applies websocket price updates and reports live status", async () => {
    vi.useFakeTimers();
    marketStore.setMarketSnapshots([market]);
    const sockets: FakeWebSocket[] = [];
    class FakeWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      readyState = 1;
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onclose: ((event: CloseEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      sent: string[] = [];
      constructor(public url: string) {
        sockets.push(this);
      }
      send(data: string) {
        this.sent.push(data);
      }
      close() {
        this.readyState = 3;
      }
    }

    const statuses: string[] = [];
    const controller = createPolymarketWebSocketController({
      assetIds: ["111", "222"],
      requestUrl: "/api/polymarket/markets?limit=250",
      webSocketConstructor: FakeWebSocket,
      onStatusChange: (status) => statuses.push(status),
    });
    controller.start();
    sockets[0].onopen?.(new Event("open"));
    sockets[0].onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({
          event_type: "last_trade_price",
          asset_id: "111",
          price: "0.73",
          timestamp: "1766789469958",
        }),
      }),
    );

    expect(JSON.parse(sockets[0].sent[0])).toMatchObject({ type: "market", custom_feature_enabled: true });
    expect(statuses).toContain("Live");
    expect(marketStore.getState().marketsById["market-1"].yesPrice).toBe(0.73);
    controller.stop();
  });

  it("falls back to polling after websocket reconnect failures", async () => {
    vi.useFakeTimers();
    marketStore.setMarketSnapshots([market]);
    const updated = { ...market, yesPrice: 0.69, noPrice: 0.31 };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ markets: [updated] }), { status: 200 })),
    );
    const sockets: FakeWebSocket[] = [];
    class FakeWebSocket {
      readyState = 1;
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onclose: ((event: CloseEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      constructor(public url: string) {
        sockets.push(this);
      }
      send() {}
      close() {}
    }

    const controller = createPolymarketWebSocketController({
      assetIds: ["111", "222"],
      intervalMs: 20,
      maxReconnectAttempts: 1,
      requestUrl: "/api/polymarket/markets?limit=250",
      webSocketConstructor: FakeWebSocket,
    });
    controller.start();
    sockets[0].onclose?.(new CloseEvent("close"));
    await vi.advanceTimersByTimeAsync(1000);
    sockets[1].onclose?.(new CloseEvent("close"));
    await vi.runOnlyPendingTimersAsync();

    expect(fetch).toHaveBeenCalled();
    expect(marketStore.getState().connectionState).toBe("Polling");
    expect(marketStore.getState().marketsById["market-1"].yesPrice).toBe(0.69);
    controller.stop();
  });
});
