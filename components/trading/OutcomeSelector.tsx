"use client";

import type { MarketOutcomeOption } from "@/components/MarketBubbleMap";

export function OutcomeSelector({
  outcomes,
  selectedOutcome,
  onSelect,
}: {
  outcomes: MarketOutcomeOption[];
  selectedOutcome: string;
  onSelect: (outcome: string) => void;
}) {
  return (
    <div className="grid gap-2">
      {outcomes.map((outcome) => (
        <button
          className={`flex h-12 items-center justify-between rounded-md border px-3 text-left transition ${
            selectedOutcome === outcome.name ? "border-cyan-400 bg-cyan-400/12 text-white" : "border-zinc-800 bg-black/35 text-zinc-200 hover:border-zinc-600"
          }`}
          key={outcome.name}
          onClick={() => onSelect(outcome.name)}
          type="button"
        >
          <span className="min-w-0 truncate text-sm font-semibold">{outcome.name}</span>
          <span className="text-lg font-black">{outcome.priceCents}c</span>
        </button>
      ))}
    </div>
  );
}

