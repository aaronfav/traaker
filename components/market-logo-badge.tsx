"use client";

import { useState } from "react";
import Image from "next/image";

function initials(label: string) {
  const words = label.replace(/[^a-z0-9\s]/gi, " ").split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return words.slice(0, 2).map((word) => word[0]).join("").toUpperCase();
}

export function MarketLogoBadge({
  label,
  logoUrl,
  size = 28,
  className = "",
}: {
  label: string;
  logoUrl?: string | null;
  size?: number;
  className?: string;
}) {
  const [failedLogoUrls, setFailedLogoUrls] = useState<string[]>([]);
  const trimmedLogoUrl = logoUrl?.trim() ?? "";
  const displayLogoUrl = trimmedLogoUrl && !failedLogoUrls.includes(trimmedLogoUrl) ? trimmedLogoUrl : "";

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-700/80 bg-slate-950/80 text-[10px] font-black uppercase tracking-[0.08em] text-slate-100 shadow-inner shadow-black/30 ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
      title={label}
    >
      {displayLogoUrl ? (
        <Image
          alt=""
          className="h-full w-full object-contain"
          height={size}
          src={displayLogoUrl}
          width={size}
          onError={() =>
            setFailedLogoUrls((current) => (current.includes(displayLogoUrl) ? current : [...current, displayLogoUrl]))
          }
        />
      ) : (
        <span className="leading-none">{initials(label)}</span>
      )}
    </span>
  );
}

export function MarketMatchupLogos({
  yesLabel,
  yesLogoUrl,
  noLabel,
  noLogoUrl,
  compact = false,
}: {
  yesLabel: string;
  yesLogoUrl?: string | null;
  noLabel: string;
  noLogoUrl?: string | null;
  compact?: boolean;
}) {
  return (
    <div className={`flex min-w-0 items-center gap-2 ${compact ? "text-xs" : "text-sm"}`}>
      <div className="flex shrink-0 items-center -space-x-2">
        <MarketLogoBadge label={yesLabel} logoUrl={yesLogoUrl} size={compact ? 22 : 26} />
        <MarketLogoBadge label={noLabel} logoUrl={noLogoUrl} size={compact ? 22 : 26} className="ring-1 ring-slate-900" />
      </div>
      <div className="min-w-0">
        <p className="truncate font-semibold text-slate-100">
          {yesLabel}
          <span className="px-1 text-slate-500">vs</span>
          {noLabel}
        </p>
      </div>
    </div>
  );
}
