import { Card, CardContent } from "@/components/ui/card";

export function MetricCard({
  label,
  value,
  detail,
  badge,
}: {
  label: string;
  value: string;
  detail?: string;
  badge?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</p>
          {badge ? <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-200">{badge}</span> : null}
        </div>
        <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-50">{value}</p>
        {detail ? <p className="mt-1 text-sm text-slate-400">{detail}</p> : null}
      </CardContent>
    </Card>
  );
}
