"use client";

import { useRef, useSyncExternalStore } from "react";

export type PortfolioPosition = {
  id: string;
  marketId: string;
  conditionId: string;
  outcome: string;
  shares: number;
  avgPrice: number;
  markPrice: number;
};

export type PortfolioExposure = {
  marketId: string;
  grossShares: number;
  grossCost: number;
  markValue: number;
  unrealizedPnl: number;
};

export type PortfolioStoreState = {
  positionsById: Record<string, PortfolioPosition>;
  lastUpdatedAt: number | null;
};

type Listener = () => void;

const initialState: PortfolioStoreState = {
  positionsById: {},
  lastUpdatedAt: null,
};

let state = initialState;
const listeners = new Set<Listener>();

function emit() {
  for (const listener of listeners) listener();
}

export function calculateUnrealizedPnl(position: Pick<PortfolioPosition, "shares" | "avgPrice" | "markPrice">) {
  return position.shares * (position.markPrice - position.avgPrice);
}

export function aggregateExposure(positions: PortfolioPosition[]): PortfolioExposure[] {
  const byMarket = new Map<string, PortfolioExposure>();
  for (const position of positions) {
    const current =
      byMarket.get(position.marketId) ??
      {
        marketId: position.marketId,
        grossShares: 0,
        grossCost: 0,
        markValue: 0,
        unrealizedPnl: 0,
      };
    current.grossShares += Math.abs(position.shares);
    current.grossCost += Math.abs(position.shares * position.avgPrice);
    current.markValue += position.shares * position.markPrice;
    current.unrealizedPnl += calculateUnrealizedPnl(position);
    byMarket.set(position.marketId, current);
  }
  return [...byMarket.values()].map((exposure) => ({
    ...exposure,
    grossShares: Number(exposure.grossShares.toFixed(8)),
    grossCost: Number(exposure.grossCost.toFixed(8)),
    markValue: Number(exposure.markValue.toFixed(8)),
    unrealizedPnl: Number(exposure.unrealizedPnl.toFixed(8)),
  }));
}

export const portfolioStore = {
  getState: () => state,
  subscribe(listener: Listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  setPositions(positions: PortfolioPosition[]) {
    state = {
      positionsById: Object.fromEntries(positions.map((position) => [position.id, position])),
      lastUpdatedAt: Date.now(),
    };
    emit();
  },
  reset() {
    state = initialState;
    emit();
  },
};

export function usePortfolioStore<T>(selector: (snapshot: PortfolioStoreState) => T) {
  const cachedRef = useRef<T>(selector(state));
  return useSyncExternalStore(
    portfolioStore.subscribe,
    () => {
      cachedRef.current = selector(portfolioStore.getState());
      return cachedRef.current;
    },
    () => selector(initialState),
  );
}
