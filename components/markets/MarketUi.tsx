import type { ReactNode } from "react";
import { CheckCircle2 } from "lucide-react";

type TagPillTone = "cyan" | "emerald" | "slate";

export function TagPill({
  children,
  icon,
  tone = "slate",
}: {
  children: ReactNode;
  icon?: ReactNode;
  tone?: TagPillTone;
}) {
  const toneClass =
    tone === "cyan"
      ? "border-cyan-400/25 bg-cyan-400/12 text-cyan-100 shadow-[0_0_18px_rgba(34,211,238,0.08)]"
      : tone === "emerald"
        ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200 shadow-[0_0_18px_rgba(52,211,153,0.08)]"
        : "border-slate-700/70 bg-slate-900/60 text-slate-200";

  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${toneClass}`}>
      {icon ? <span className="shrink-0 leading-none">{icon}</span> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

export function MarketPanelHeader({
  category,
  categoryIcon,
  status,
  timestamp,
  title,
  subtitle,
  actions,
}: {
  category?: string;
  categoryIcon?: ReactNode;
  status: string;
  timestamp: string;
  title: string;
  subtitle?: string;
  actions: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-800/85 px-5 py-5">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {category ? (
            <TagPill tone="cyan" icon={categoryIcon}>
              {category}
            </TagPill>
          ) : null}
          <TagPill
            tone="emerald"
            icon={<span className="block h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_10px_rgba(52,211,153,0.95)]" />}
          >
            {status}
          </TagPill>
          <span className="min-w-0 truncate text-xs font-medium text-slate-500">{timestamp}</span>
        </div>
        <h2 className="mt-5 line-clamp-2 text-2xl font-semibold leading-tight tracking-tight text-slate-50">{title}</h2>
        {subtitle ? <p className="mt-2 truncate text-sm font-medium text-slate-400">{subtitle}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">{actions}</div>
    </div>
  );
}

export function OutcomeCard({
  name,
  price,
  selected,
  onClick,
}: {
  name: string;
  price: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`grid min-h-[64px] w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border px-4 py-3 text-left transition duration-200 ${
        selected
          ? "border-cyan-300/70 bg-cyan-300/10 text-white shadow-[0_0_24px_rgba(34,211,238,0.12),inset_0_1px_0_rgba(255,255,255,0.05)]"
          : "border-slate-800/90 bg-slate-950/45 text-slate-200 hover:border-slate-700 hover:bg-slate-900/70"
      }`}
      onClick={onClick}
      type="button"
    >
      <span className="min-w-0 overflow-hidden">
        <span className="line-clamp-2 break-words text-base font-semibold leading-snug">{name}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2 pl-2 text-right text-lg font-black tabular-nums">
        {price}
        {selected ? <CheckCircle2 className="h-4 w-4 text-cyan-300" /> : null}
      </span>
    </button>
  );
}

export function EstimateRow({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <span className="text-sm font-medium text-slate-400">{label}</span>
      <span className={`shrink-0 text-sm font-bold tabular-nums ${accent ? "text-emerald-300" : "text-slate-50"}`}>{value}</span>
    </div>
  );
}
