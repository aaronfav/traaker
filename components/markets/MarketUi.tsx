"use client";

import { useState, type ReactNode } from "react";
import Image from "next/image";
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
    <span data-tone={tone} className={`traak-market-chip inline-flex min-w-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${toneClass}`}>
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
    <div className="traak-trade-panel-header sticky top-0 z-20 flex items-start justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-4 shadow-[0_10px_24px_rgba(0,0,0,0.16)] backdrop-blur-2xl sm:px-5">
      <div className="min-w-0 flex-1 overflow-hidden">
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
          <span className="min-w-0 truncate text-xs font-medium text-[var(--muted)]">{timestamp}</span>
        </div>
        <h2 className="mt-3.5 line-clamp-3 max-w-full overflow-hidden break-words text-xl font-semibold leading-tight text-[var(--foreground)] [overflow-wrap:anywhere] sm:line-clamp-2 sm:text-2xl">
          {title}
        </h2>
        {subtitle ? <p className="mt-1.5 truncate text-sm font-medium text-[var(--muted)]">{subtitle}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">{actions}</div>
    </div>
  );
}

export function OutcomeCard({
  name,
  price,
  logoUrl,
  flagUrl,
  teamDisplayName,
  fallbackIcon,
  fallbackIconSrc,
  recentForm,
  ranking,
  record,
  oddsLabel,
  selected,
  onClick,
}: {
  name: string;
  price: string;
  logoUrl?: string;
  flagUrl?: string;
  teamDisplayName?: string;
  fallbackIcon?: string;
  fallbackIconSrc?: string;
  recentForm?: string[];
  ranking?: number;
  record?: string;
  oddsLabel?: string;
  selected: boolean;
  onClick: () => void;
}) {
  const testId = `outcome-logo-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "option"}`;
  const [failedLogoUrls, setFailedLogoUrls] = useState<string[]>([]);
  const displayLogoUrl = logoUrl && !failedLogoUrls.includes(logoUrl) ? logoUrl : undefined;
  const logoIsExternal = displayLogoUrl ? /^https?:\/\//i.test(displayLogoUrl) : false;

  return (
    <button
      aria-pressed={selected}
      className={`traak-outcome-card grid min-h-[66px] w-full grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border px-3 py-3 text-left transition duration-200 ${
        selected
          ? "border-cyan-300/70 bg-cyan-300/10 text-[var(--foreground)] shadow-[0_0_20px_rgba(34,211,238,0.1),inset_0_1px_0_rgba(255,255,255,0.05)]"
          : "border-[var(--border)] bg-[var(--surface-3)] text-[var(--foreground)] hover:border-cyan-300/60 hover:bg-[var(--surface-2)]"
      }`}
      onClick={onClick}
      type="button"
    >
      <span className="relative grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full border border-[var(--border)] bg-[var(--surface)] shadow-inner shadow-black/30">
        {displayLogoUrl && logoIsExternal ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            data-testid={testId}
            data-logo-url={displayLogoUrl}
            src={displayLogoUrl}
            alt=""
            width={32}
            height={32}
            className="h-8 w-8 object-contain"
            loading="lazy"
            decoding="async"
            onError={() => setFailedLogoUrls((current) => (current.includes(displayLogoUrl) ? current : [...current, displayLogoUrl]))}
          />
        ) : displayLogoUrl ? (
          <Image
            data-testid={testId}
            data-logo-url={displayLogoUrl}
            src={displayLogoUrl}
            alt=""
            width={32}
            height={32}
            className="h-8 w-8 object-contain"
            onError={() => setFailedLogoUrls((current) => (current.includes(displayLogoUrl) ? current : [...current, displayLogoUrl]))}
          />
        ) : fallbackIconSrc ? (
          <Image data-testid={testId} data-logo-url={fallbackIconSrc} src={fallbackIconSrc} alt="" width={28} height={28} className="h-7 w-7 object-contain opacity-85" />
        ) : (
          <span data-testid={testId} className="text-base leading-none text-[var(--muted)]">
            {fallbackIcon || (teamDisplayName ?? name).slice(0, 1).toUpperCase()}
          </span>
        )}
        {flagUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt=""
            className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full border border-white/70 object-cover shadow-lg shadow-black/20"
            src={flagUrl}
          />
        ) : null}
      </span>
      <span className="min-w-0 overflow-hidden self-center">
        <span className="line-clamp-2 break-words text-[0.95rem] font-semibold leading-snug [overflow-wrap:anywhere]">{teamDisplayName || name}</span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--muted)]">
          {typeof ranking === "number" ? <span className="rounded-full border border-[var(--border)] px-2 py-0.5 font-semibold">#{ranking}</span> : null}
          {record ? <span className="rounded-full border border-[var(--border)] px-2 py-0.5 font-semibold">{record}</span> : null}
          {oddsLabel ? <span className="rounded-full border border-[var(--border)] px-2 py-0.5 font-semibold text-cyan-500">{oddsLabel}</span> : null}
        </span>
        {recentForm?.length ? (
          <span className="mt-1.5 flex items-center gap-1">
            {recentForm.slice(0, 5).map((symbol, index) => {
              const tone = symbol === "W" ? "bg-emerald-500/80" : symbol === "L" ? "bg-rose-500/80" : "bg-slate-400/70";
              return <span key={`${name}-form-${index}`} className={`h-1.5 w-4 rounded-full ${tone}`} />;
            })}
          </span>
        ) : null}
      </span>
      <span className="flex shrink-0 items-center justify-end gap-2 pl-2 text-right text-lg font-black tabular-nums">
        {price}
        {selected ? <CheckCircle2 className="h-4 w-4 text-cyan-300" /> : null}
      </span>
    </button>
  );
}

export function EstimateRow({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="traak-estimate-row flex items-center justify-between gap-4 px-4 py-3">
      <span className="text-sm font-medium text-[var(--muted)]">{label}</span>
      <span className={`shrink-0 text-sm font-bold tabular-nums ${accent ? "text-emerald-300" : "text-[var(--foreground)]"}`}>{value}</span>
    </div>
  );
}
