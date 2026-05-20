"use client";

import { useEffect, useState } from "react";
import type { TerminalMarket } from "@/lib/polymarket/types";

export type LiveUpdateStatus = "Live" | "Updating" | "Polling" | "Offline";

type MarketsPayload = {
  markets?: TerminalMarket[];
};

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

export function useMarketLiveUpdates({
  enabled,
  intervalMs = 25_000,
  onMarketsUpdate,
  requestUrl,
}: {
  enabled: boolean;
  intervalMs?: number;
  onMarketsUpdate: (markets: TerminalMarket[]) => void;
  requestUrl: string;
}) {
  const [status, setStatus] = useState<LiveUpdateStatus>(enabled ? "Polling" : "Offline");

  useEffect(() => {
    if (!enabled) {
      setStatus("Offline");
      return;
    }

    let cancelled = false;
    let timer: number | null = null;

    const poll = async () => {
      setStatus("Updating");
      try {
        const response = await fetch(requestUrl, { cache: "no-store" });
        const payload = (await response.json().catch(() => null)) as MarketsPayload | null;
        if (!response.ok || !Array.isArray(payload?.markets)) {
          throw new Error("Unable to refresh live market prices.");
        }
        if (!cancelled) {
          onMarketsUpdate(payload.markets);
          setStatus("Live");
        }
      } catch (error) {
        if (!cancelled) {
          console.error(error);
          setStatus("Offline");
        }
      } finally {
        if (!cancelled) timer = window.setTimeout(poll, intervalMs);
      }
    };

    setStatus("Polling");
    timer = window.setTimeout(poll, intervalMs);

    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [enabled, intervalMs, onMarketsUpdate, requestUrl]);

  return status;
}
