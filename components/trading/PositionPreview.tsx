"use client";

const money = (value: number) => `$${(Number.isFinite(value) ? value : 0).toFixed(2)}`;

export function PositionPreview({
  outcome,
  quantity,
  estimatedProfit,
}: {
  outcome: string;
  quantity: number;
  estimatedProfit: number;
}) {
  return (
    <div className="rounded-md border border-zinc-800 bg-black/35 p-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-zinc-400">Position</span>
        <span className="min-w-0 truncate font-semibold text-zinc-100">{outcome}</span>
      </div>
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="text-zinc-400">Shares</span>
        <span className="font-semibold text-zinc-100">{quantity.toFixed(2)}</span>
      </div>
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="text-zinc-400">Max profit</span>
        <span className="font-semibold text-emerald-300">{money(estimatedProfit)}</span>
      </div>
    </div>
  );
}

