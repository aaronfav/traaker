"use client";

import { useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { MarketBubbleNode } from "@/components/MarketBubbleMap";
import { OutcomeSelector } from "@/components/trading/OutcomeSelector";
import { OrderSummary } from "@/components/trading/OrderSummary";
import { PositionPreview } from "@/components/trading/PositionPreview";
import { calculateTradeTicket, type TradeOrderType } from "@/components/trading/tradeCalculations";

function useOptionalWalletConnected() {
  try {
    return useAccount().isConnected;
  } catch {
    return false;
  }
}

export function TradeTicket({ market }: { market: MarketBubbleNode }) {
  const isConnected = useOptionalWalletConnected();
  const [selectedOutcome, setSelectedOutcome] = useState(() => market.favoredOutcome || market.outcomes[0]?.name);
  const [quantity, setQuantity] = useState("10");
  const [orderType, setOrderType] = useState<TradeOrderType>("market");
  const selected = market.outcomes.find((outcome) => outcome.name === selectedOutcome) ?? market.outcomes[0];
  const [limitPrice, setLimitPrice] = useState(() => String(selected?.priceCents ?? market.priceCents));
  const numericQuantity = Number(quantity);
  const numericLimitPrice = Number(limitPrice) / 100;

  const summary = useMemo(
    () =>
      calculateTradeTicket({
        price: selected?.price ?? market.favoredPrice,
        quantity: Number.isFinite(numericQuantity) ? numericQuantity : 0,
        limitPrice: Number.isFinite(numericLimitPrice) ? numericLimitPrice : undefined,
        orderType,
        bestAsk: market.bestAsk,
      }),
    [market.bestAsk, market.favoredPrice, numericLimitPrice, numericQuantity, orderType, selected?.price],
  );

  const canSubmit = isConnected && numericQuantity > 0 && selected;

  return (
    <div className="mt-5 rounded-md border border-zinc-800 bg-zinc-950/85 p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">Order ticket</p>
        <div className="flex rounded-md border border-zinc-800 bg-black p-0.5">
          {(["market", "limit"] as const).map((type) => (
            <button
              className={`h-7 rounded px-3 text-xs font-semibold capitalize transition ${orderType === type ? "bg-zinc-100 text-black" : "text-zinc-400 hover:text-zinc-100"}`}
              key={type}
              onClick={() => setOrderType(type)}
              type="button"
            >
              {type}
            </button>
          ))}
        </div>
      </div>

      <OutcomeSelector outcomes={market.outcomes} onSelect={setSelectedOutcome} selectedOutcome={selectedOutcome} />

      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="block text-sm">
          <span className="text-xs text-zinc-500">Quantity</span>
          <Input className="mt-1 border-zinc-800 bg-black" min="0" onChange={(event) => setQuantity(event.target.value)} type="number" value={quantity} />
        </label>
        <label className="block text-sm">
          <span className="text-xs text-zinc-500">Limit price</span>
          <Input
            className="mt-1 border-zinc-800 bg-black"
            disabled={orderType === "market"}
            max="99"
            min="1"
            onChange={(event) => setLimitPrice(event.target.value)}
            type="number"
            value={limitPrice}
          />
        </label>
      </div>

      <div className="mt-3 grid gap-3">
        <OrderSummary summary={summary} />
        <PositionPreview estimatedProfit={summary.estimatedProfit} outcome={selected?.name ?? selectedOutcome} quantity={Number.isFinite(numericQuantity) ? numericQuantity : 0} />
      </div>

      <Button className="mt-3 w-full" disabled={!canSubmit} type="button">
        {isConnected ? "Submit disabled until execution is enabled" : "Connect wallet to trade"}
      </Button>
    </div>
  );
}
