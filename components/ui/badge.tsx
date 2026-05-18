import * as React from "react";
import { cn } from "@/lib/utils";

type BadgeTone = "default" | "cyan" | "green" | "amber" | "rose" | "slate";

const tones: Record<BadgeTone, string> = {
  default: "border-slate-700 bg-slate-900 text-slate-200",
  cyan: "border-cyan-400/30 bg-cyan-400/10 text-cyan-200",
  green: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
  amber: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  rose: "border-rose-400/30 bg-rose-400/10 text-rose-200",
  slate: "border-slate-700 bg-slate-900/70 text-slate-300",
};

export function Badge({
  className,
  tone = "default",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
