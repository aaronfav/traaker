"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { MarketChartPoint } from "@/lib/polymarket/types";

export function MarketChart({ data }: { data: MarketChartPoint[] }) {
  return (
    <div className="h-[320px] w-full">
      <ResponsiveContainer>
        <AreaChart data={data.map((point) => ({ ...point, label: new Date(point.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }))}>
          <defs>
            <linearGradient id="yesPrice" x1="0" x2="0" y1="0" y2="1">
              <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.35} />
              <stop offset="95%" stopColor="#22d3ee" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
          <XAxis dataKey="label" minTickGap={28} stroke="#64748b" tickLine={false} />
          <YAxis domain={[0, 1]} stroke="#64748b" tickFormatter={(value) => `${Math.round(Number(value) * 100)}c`} tickLine={false} />
          <Tooltip
            contentStyle={{ background: "#020617", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0" }}
            formatter={(value) => [`${(Number(value ?? 0) * 100).toFixed(1)}c`, "YES"]}
          />
          <Area dataKey="yes" fill="url(#yesPrice)" stroke="#22d3ee" strokeWidth={2} type="monotone" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
