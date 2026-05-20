"use client";

import { useRef, useSyncExternalStore } from "react";
import type { TerminalMarket } from "@/lib/polymarket/types";

export type MarketConnectionState = "Live" | "Reconnecting" | "Polling" | "Offline";

export type MarketOutcomePriceMap = Record<string, number>;

export type MarketValueState = {
  marketId: string;
  outcomePrices: MarketOutcomePriceMap;
  movement: number;
  liquidity: number;
  volume: number;
  bestBid?: number;
  bestAsk?: number;
  lastTradePrice?: number;
  lastUpdateTimestamp: number;
};

export type MarketStoreState = {
  marketsById: Record<string, TerminalMarket>;
  marketValuesById: Record<string, MarketValueState>;
  marketIdsByConditionId: Record<string, string>;
  marketIdsByAssetId: Record<string, { marketId: string; outcomeKey: "yes" | "no" }>;
  selectedMarketId: string | null;
  connectionState: MarketConnectionState;
  lastUpdateTimestamp: number | null;
};

type Listener = () => void;

const clampPrice = (value: number, fallback = 0.5) => {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0.01, Math.min(0.99, value));
};

const asNumber = (value: unknown, fallback = Number.NaN) => {
  const numeric = typeof value === "string" ? Number(value) : typeof value === "number" ? value : Number.NaN;
  return Number.isFinite(numeric) ? numeric : fallback;
};

function createMarketValue(market: TerminalMarket, timestamp = Date.now()): MarketValueState {
  return {
    marketId: market.id,
    outcomePrices: {
      [market.outcomes.yes]: market.yesPrice,
      [market.outcomes.no]: market.noPrice,
      yes: market.yesPrice,
      no: market.noPrice,
    },
    movement: market.priceMove24h,
    liquidity: market.liquidity,
    volume: market.volume,
    bestBid: market.bestBid,
    bestAsk: market.bestAsk,
    lastTradePrice: market.lastTradePrice,
    lastUpdateTimestamp: timestamp,
  };
}

const initialState: MarketStoreState = {
  marketsById: {},
  marketValuesById: {},
  marketIdsByConditionId: {},
  marketIdsByAssetId: {},
  selectedMarketId: null,
  connectionState: "Offline",
  lastUpdateTimestamp: null,
};

let state = initialState;
const listeners = new Set<Listener>();

function emit() {
  for (const listener of listeners) listener();
}

function rebuildIndexes(marketsById: Record<string, TerminalMarket>) {
  const marketIdsByConditionId: MarketStoreState["marketIdsByConditionId"] = {};
  const marketIdsByAssetId: MarketStoreState["marketIdsByAssetId"] = {};

  for (const market of Object.values(marketsById)) {
    marketIdsByConditionId[market.conditionId] = market.id;
    if (market.tokenIds.yes) marketIdsByAssetId[market.tokenIds.yes] = { marketId: market.id, outcomeKey: "yes" };
    if (market.tokenIds.no) marketIdsByAssetId[market.tokenIds.no] = { marketId: market.id, outcomeKey: "no" };
  }

  return { marketIdsByConditionId, marketIdsByAssetId };
}

function mergeMarketSnapshot(current: TerminalMarket | undefined, incoming: TerminalMarket): TerminalMarket {
  if (!current) return incoming;
  return {
    ...current,
    ...incoming,
    id: current.id,
    conditionId: current.conditionId,
    tokenIds: incoming.tokenIds ?? current.tokenIds,
    outcomes: incoming.outcomes ?? current.outcomes,
  };
}

function setState(nextState: MarketStoreState) {
  state = nextState;
  emit();
}

function setMarketSnapshots(markets: TerminalMarket[], options: { replace?: boolean } = {}) {
  const timestamp = Date.now();
  const marketsById = options.replace ? {} : { ...state.marketsById };
  const marketValuesById = options.replace ? {} : { ...state.marketValuesById };

  for (const market of markets) {
    const current = marketsById[market.id];
    const merged = mergeMarketSnapshot(current, market);
    marketsById[market.id] = merged;
    marketValuesById[market.id] = {
      ...createMarketValue(merged, timestamp),
      bestBid: market.bestBid ?? marketValuesById[market.id]?.bestBid,
      bestAsk: market.bestAsk ?? marketValuesById[market.id]?.bestAsk,
      lastTradePrice: market.lastTradePrice ?? marketValuesById[market.id]?.lastTradePrice,
    };
  }

  const indexes = rebuildIndexes(marketsById);
  setState({
    ...state,
    marketsById,
    marketValuesById,
    ...indexes,
    lastUpdateTimestamp: timestamp,
  });
}

function setConnectionState(connectionState: MarketConnectionState) {
  if (state.connectionState === connectionState) return;
  setState({ ...state, connectionState });
}

function setSelectedMarketId(selectedMarketId: string | null) {
  if (state.selectedMarketId === selectedMarketId) return;
  setState({ ...state, selectedMarketId });
}

type PricePatch = {
  assetId: string;
  price?: number;
  bestBid?: number;
  bestAsk?: number;
  lastTradePrice?: number;
  timestamp?: number;
};

function applyAssetPricePatch(patch: PricePatch) {
  const assetMapping = state.marketIdsByAssetId[patch.assetId];
  if (!assetMapping) return;
  const currentMarket = state.marketsById[assetMapping.marketId];
  if (!currentMarket) return;

  const currentValue = state.marketValuesById[currentMarket.id] ?? createMarketValue(currentMarket);
  const previousPrice = assetMapping.outcomeKey === "yes" ? currentMarket.yesPrice : currentMarket.noPrice;
  const nextPrice = clampPrice(patch.lastTradePrice ?? patch.price ?? patch.bestAsk ?? patch.bestBid ?? previousPrice, previousPrice);
  const timestamp = patch.timestamp ?? Date.now();
  const nextMarket: TerminalMarket = {
    ...currentMarket,
    yesPrice: assetMapping.outcomeKey === "yes" ? nextPrice : currentMarket.yesPrice,
    noPrice: assetMapping.outcomeKey === "no" ? nextPrice : currentMarket.noPrice,
    bestBid: patch.bestBid ?? currentMarket.bestBid,
    bestAsk: patch.bestAsk ?? currentMarket.bestAsk,
    lastTradePrice: patch.lastTradePrice ?? currentMarket.lastTradePrice,
    spread: Number.isFinite(patch.bestBid) && Number.isFinite(patch.bestAsk) ? Math.max(0, (patch.bestAsk as number) - (patch.bestBid as number)) : currentMarket.spread,
  };
  const marketValuesById = {
    ...state.marketValuesById,
    [currentMarket.id]: {
      ...currentValue,
      outcomePrices: {
        ...currentValue.outcomePrices,
        [nextMarket.outcomes.yes]: nextMarket.yesPrice,
        [nextMarket.outcomes.no]: nextMarket.noPrice,
        yes: nextMarket.yesPrice,
        no: nextMarket.noPrice,
      },
      movement: nextMarket.priceMove24h,
      liquidity: nextMarket.liquidity,
      volume: nextMarket.volume,
      bestBid: patch.bestBid ?? currentValue.bestBid,
      bestAsk: patch.bestAsk ?? currentValue.bestAsk,
      lastTradePrice: patch.lastTradePrice ?? currentValue.lastTradePrice,
      lastUpdateTimestamp: timestamp,
    },
  };

  setState({
    ...state,
    marketsById: {
      ...state.marketsById,
      [currentMarket.id]: nextMarket,
    },
    marketValuesById,
    lastUpdateTimestamp: timestamp,
  });
}

type ClobMessage = Record<string, unknown>;

function normalizeTimestamp(value: unknown) {
  const numeric = asNumber(value, Date.now());
  return numeric > 10_000_000_000 ? numeric : numeric * 1000;
}

function priceFromBookSide(levels: unknown, mode: "bid" | "ask") {
  if (!Array.isArray(levels)) return undefined;
  const prices = levels.map((level) => asNumber((level as Record<string, unknown>)?.price)).filter(Number.isFinite);
  if (!prices.length) return undefined;
  return mode === "bid" ? Math.max(...prices) : Math.min(...prices);
}

function applyClobMessage(rawMessage: unknown) {
  const messages = Array.isArray(rawMessage) ? rawMessage : [rawMessage];
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const record = message as ClobMessage;
    const eventType = String(record.event_type ?? record.type ?? "");
    const timestamp = normalizeTimestamp(record.timestamp);

    if (eventType === "price_change" && Array.isArray(record.price_changes)) {
      for (const change of record.price_changes) {
        if (!change || typeof change !== "object") continue;
        const item = change as ClobMessage;
        applyAssetPricePatch({
          assetId: String(item.asset_id ?? ""),
          price: asNumber(item.price),
          bestBid: asNumber(item.best_bid),
          bestAsk: asNumber(item.best_ask),
          timestamp,
        });
      }
      continue;
    }

    const assetId = String(record.asset_id ?? "");
    if (!assetId) continue;

    if (eventType === "best_bid_ask") {
      applyAssetPricePatch({
        assetId,
        bestBid: asNumber(record.best_bid),
        bestAsk: asNumber(record.best_ask),
        timestamp,
      });
      continue;
    }

    if (eventType === "last_trade_price") {
      applyAssetPricePatch({
        assetId,
        lastTradePrice: asNumber(record.price),
        timestamp,
      });
      continue;
    }

    if (eventType === "book") {
      const bestBid = priceFromBookSide(record.bids, "bid");
      const bestAsk = priceFromBookSide(record.asks, "ask");
      const midpoint = Number.isFinite(bestBid) && Number.isFinite(bestAsk) ? ((bestBid as number) + (bestAsk as number)) / 2 : undefined;
      applyAssetPricePatch({
        assetId,
        price: midpoint,
        bestBid,
        bestAsk,
        timestamp,
      });
    }
  }
}

export const marketStore = {
  getState: () => state,
  subscribe(listener: Listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  setMarketSnapshots,
  applyMarketSnapshots: (markets: TerminalMarket[]) => setMarketSnapshots(markets, { replace: false }),
  applyClobMessage,
  setConnectionState,
  setSelectedMarketId,
  reset() {
    state = initialState;
    emit();
  },
};

export function shallowEqual<T>(left: T, right: T) {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const leftKeys = Object.keys(left as Record<string, unknown>);
  const rightKeys = Object.keys(right as Record<string, unknown>);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => Object.is((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
}

export function useMarketStore<T>(selector: (snapshot: MarketStoreState) => T, isEqual: (left: T, right: T) => boolean = Object.is) {
  const cachedRef = useRef<{ hasValue: boolean; value: T }>({ hasValue: false, value: selector(state) });

  return useSyncExternalStore(
    marketStore.subscribe,
    () => {
      const nextValue = selector(marketStore.getState());
      if (cachedRef.current.hasValue && isEqual(cachedRef.current.value, nextValue)) {
        return cachedRef.current.value;
      }
      cachedRef.current = { hasValue: true, value: nextValue };
      return nextValue;
    },
    () => selector(initialState),
  );
}
