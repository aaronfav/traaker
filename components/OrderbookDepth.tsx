import type { NormalizedOrderbook } from "@/lib/polymarket/types";

export function OrderbookDepth({ orderbook }: { orderbook: NormalizedOrderbook }) {
  const maxTotal = Math.max(...orderbook.bids.map((level) => level.total), ...orderbook.asks.map((level) => level.total), 1);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {[
        { label: "Bids", levels: orderbook.bids, tone: "bg-emerald-400/20" },
        { label: "Asks", levels: orderbook.asks, tone: "bg-rose-400/20" },
      ].map((side) => (
        <div key={side.label}>
          <div className="mb-2 grid grid-cols-3 text-xs uppercase tracking-[0.16em] text-slate-500">
            <span>{side.label}</span>
            <span className="text-right">Size</span>
            <span className="text-right">Total</span>
          </div>
          <div className="space-y-1">
            {side.levels.map((level) => (
              <div className="relative grid grid-cols-3 overflow-hidden rounded-md border border-slate-800 px-3 py-2 text-sm" key={`${side.label}-${level.price}`}>
                <div className={`absolute inset-y-0 right-0 ${side.tone}`} style={{ width: `${Math.max(4, (level.total / maxTotal) * 100)}%` }} />
                <span className="relative font-medium text-slate-100">{(level.price * 100).toFixed(1)}c</span>
                <span className="relative text-right text-slate-300">{level.size.toLocaleString()}</span>
                <span className="relative text-right text-slate-400">{level.total.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
