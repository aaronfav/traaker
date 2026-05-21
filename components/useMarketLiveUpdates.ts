"use client";

import { useEffect, useMemo } from "react";
import { marketStore, useMarketStore, type MarketConnectionState } from "@/app/store/marketStore";
import type { TerminalMarket } from "@/lib/polymarket/types";

export type LiveUpdateStatus = MarketConnectionState;

export const POLYMARKET_MARKET_WS_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/market";
const DEFAULT_POLL_INTERVAL_MS = 20_000;
const HEARTBEAT_INTERVAL_MS = 10_000;
const SUBSCRIPTION_TIMEOUT_MS = 12_000;

type MarketsPayload = {
  markets?: TerminalMarket[];
};

type WebSocketLike = {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
};

type WebSocketConstructorLike = new (url: string) => WebSocketLike;

export function mergeLiveMarketUpdates(currentMarkets: TerminalMarket[], incomingMarkets: TerminalMarket[]) {
  const incomingById = new Map(incomingMarkets.map((market) => [market.id, market]));
  const incomingByConditionId = new Map(incomingMarkets.map((market) => [market.conditionId, market]));

  return currentMarkets.map((market) => {
    const incoming = incomingById.get(market.id) ?? incomingByConditionId.get(market.conditionId);
    if (!incoming) return market;
    return {
      ...market,
      ...incoming,
      id: market.id,
      conditionId: market.conditionId,
    };
  });
}

function getAssetIds(markets: TerminalMarket[]) {
  return markets
    .flatMap((market) => (market.outcomeOptions?.length ? market.outcomeOptions.map((outcome) => outcome.tokenId) : [market.tokenIds.yes, market.tokenIds.no]))
    .filter(Boolean);
}

function backoffDelay(attempt: number) {
  return Math.min(30_000, 1_000 * 2 ** Math.max(0, attempt - 1));
}

async function fetchMarkets(requestUrl: string) {
  const response = await fetch(requestUrl, { cache: "no-store" });
  const payload = (await response.json().catch(() => null)) as MarketsPayload | null;
  if (!response.ok || !Array.isArray(payload?.markets)) {
    throw new Error("Unable to refresh live market prices.");
  }
  return payload.markets;
}

export function createPolymarketWebSocketController({
  assetIds,
  requestUrl,
  intervalMs = DEFAULT_POLL_INTERVAL_MS,
  maxReconnectAttempts = 3,
  webSocketConstructor,
  websocketUrl = POLYMARKET_MARKET_WS_URL,
  onMarketsUpdate,
  onStatusChange,
}: {
  assetIds: string[];
  requestUrl: string;
  intervalMs?: number;
  maxReconnectAttempts?: number;
  webSocketConstructor?: WebSocketConstructorLike;
  websocketUrl?: string;
  onMarketsUpdate?: (markets: TerminalMarket[]) => void;
  onStatusChange?: (status: LiveUpdateStatus) => void;
}) {
  let stopped = false;
  let ws: WebSocketLike | null = null;
  let reconnectAttempts = 0;
  let reconnectTimer: number | null = null;
  let heartbeatTimer: number | null = null;
  let subscriptionTimer: number | null = null;
  let pollingTimer: number | null = null;
  let receivedMessage = false;
  const uniqueAssetIds = [...new Set(assetIds)].filter(Boolean);

  const setStatus = (status: LiveUpdateStatus) => {
    marketStore.setConnectionState(status);
    onStatusChange?.(status);
  };

  const clearTimer = (timer: number | null) => {
    if (timer !== null) window.clearTimeout(timer);
  };

  const clearIntervalTimer = (timer: number | null) => {
    if (timer !== null) window.clearInterval(timer);
  };

  const cleanupSocketTimers = () => {
    clearIntervalTimer(heartbeatTimer);
    clearTimer(subscriptionTimer);
    heartbeatTimer = null;
    subscriptionTimer = null;
  };

  const schedulePolling = () => {
    clearTimer(pollingTimer);
    if (stopped) return;
    pollingTimer = window.setTimeout(runPoll, intervalMs);
  };

  const runPoll = async () => {
    if (stopped) return;
    setStatus("Polling");
    try {
      const markets = await fetchMarkets(requestUrl);
      if (stopped) return;
      marketStore.applyMarketSnapshots(markets);
      onMarketsUpdate?.(markets);
      setStatus("Polling");
    } catch (error) {
      if (!stopped) {
        console.error(error);
        setStatus("Offline");
      }
    } finally {
      schedulePolling();
    }
  };

  const fallbackToPolling = () => {
    cleanupSocketTimers();
    if (ws) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
      try {
        ws.close();
      } catch {
        // ignored: the browser may already have closed the socket.
      }
      ws = null;
    }
    runPoll();
  };

  const scheduleReconnect = () => {
    cleanupSocketTimers();
    if (stopped) return;
    reconnectAttempts += 1;
    if (reconnectAttempts > maxReconnectAttempts) {
      fallbackToPolling();
      return;
    }
    setStatus("Reconnecting");
    reconnectTimer = window.setTimeout(connect, backoffDelay(reconnectAttempts));
  };

  const connect = () => {
    clearTimer(reconnectTimer);
    if (stopped) return;

    if (uniqueAssetIds.length === 0 || typeof window === "undefined" || typeof (webSocketConstructor ?? window.WebSocket) === "undefined") {
      fallbackToPolling();
      return;
    }

    const WebSocketImpl = webSocketConstructor ?? window.WebSocket;
    receivedMessage = false;
    setStatus(reconnectAttempts > 0 ? "Reconnecting" : "Live");

    try {
      ws = new WebSocketImpl(websocketUrl);
    } catch (error) {
      console.error(error);
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      if (!ws || stopped) return;
      try {
        ws.send(
          JSON.stringify({
            assets_ids: uniqueAssetIds,
            type: "market",
            custom_feature_enabled: true,
          }),
        );
      } catch (error) {
        console.error(error);
        fallbackToPolling();
        return;
      }

      setStatus("Live");
      heartbeatTimer = window.setInterval(() => {
        if (!ws || stopped) return;
        try {
          ws.send("PING");
        } catch {
          scheduleReconnect();
        }
      }, HEARTBEAT_INTERVAL_MS);

      subscriptionTimer = window.setTimeout(() => {
        if (!receivedMessage && !stopped) scheduleReconnect();
      }, SUBSCRIPTION_TIMEOUT_MS);
    };

    ws.onmessage = (event) => {
      if (stopped) return;
      const data = typeof event.data === "string" ? event.data : "";
      if (data === "PONG" || data === "pong") return;
      if (data === "ping") {
        ws?.send("pong");
        return;
      }

      receivedMessage = true;
      clearTimer(subscriptionTimer);
      subscriptionTimer = null;
      reconnectAttempts = 0;
      setStatus("Live");
      try {
        marketStore.applyClobMessage(JSON.parse(data));
      } catch (error) {
        console.error(error);
      }
    };

    ws.onclose = () => {
      if (!stopped) scheduleReconnect();
    };
    ws.onerror = () => {
      if (!stopped) scheduleReconnect();
    };
  };

  return {
    start() {
      stopped = false;
      connect();
    },
    stop() {
      stopped = true;
      cleanupSocketTimers();
      clearTimer(reconnectTimer);
      clearTimer(pollingTimer);
      if (ws) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onclose = null;
        ws.onerror = null;
        ws.close();
      }
      ws = null;
    },
    forcePolling: fallbackToPolling,
  };
}

export function useMarketLiveUpdates({
  enabled,
  intervalMs = DEFAULT_POLL_INTERVAL_MS,
  onMarketsUpdate,
  requestUrl,
  markets = [],
}: {
  enabled: boolean;
  intervalMs?: number;
  onMarketsUpdate?: (markets: TerminalMarket[]) => void;
  requestUrl: string;
  markets?: TerminalMarket[];
}) {
  const status = useMarketStore((snapshot) => snapshot.connectionState);
  const assetIds = useMemo(() => getAssetIds(markets), [markets]);

  useEffect(() => {
    if (!enabled) {
      marketStore.setConnectionState("Offline");
      return;
    }

    const controller = createPolymarketWebSocketController({
      assetIds,
      intervalMs,
      onMarketsUpdate,
      requestUrl,
    });
    controller.start();

    return () => controller.stop();
  }, [assetIds, enabled, intervalMs, onMarketsUpdate, requestUrl]);

  return status;
}
