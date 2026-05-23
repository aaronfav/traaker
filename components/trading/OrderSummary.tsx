"use client";

import { calculateTradeTicket } from "@/components/trading/tradeCalculations";

const money = (value: number) => `$${(Number.isFinite(value) ? value : 0).toFixed(2)}`;
const cents = (value: number) => `${Math.round((Number.isFinite(value) ? value : 0) * 100)}c`;

export function OrderSummary({ summary }: { summary: ReturnType<typeof calculateTradeTicket> }) {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-950/85 p-3 text-sm">
      <div className="flex justify-between py-1">
        <span className="text-zinc-500">Avg price</span>
        <span className="font-semibold text-zinc-100">{cents(summary.avgPrice)}</span>
      </div>
      <div className="flex justify-between py-1">
        <span className="text-zinc-500">Cost</span>
        <span className="font-semibold text-zinc-100">{money(summary.cost)}</span>
      </div>
      <div className="flex justify-between py-1">
        <span className="text-zinc-500">Estimated payout</span>
        <span className="font-semibold text-zinc-100">{money(summary.estimatedPayout)}</span>
      </div>
    </div>
  );
}
