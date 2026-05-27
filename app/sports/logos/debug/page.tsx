import { headers } from "next/headers";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;
type PageProps = {
  searchParams?: Promise<SearchParams> | SearchParams;
};

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function joinValues(value: string | string[] | undefined) {
  return Array.isArray(value) ? value.join(",") : value ?? "";
}

export default async function SportsLogoDebugPage({ searchParams }: PageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const category = firstValue(resolvedSearchParams?.category) || "Soccer";
  const sport = firstValue(resolvedSearchParams?.sport) || category;
  const market = firstValue(resolvedSearchParams?.market) || firstValue(resolvedSearchParams?.marketTitle) || "";
  const teams = joinValues(resolvedSearchParams?.teams);
  const headerList = await headers();
  const host = headerList.get("host") || "127.0.0.1:3000";
  const protocol = headerList.get("x-forwarded-proto") || "http";
  const debugUrl = `${protocol}://${host}/api/sports/logos/debug?${new URLSearchParams({
    category,
    sport,
    market,
    teams,
  }).toString()}`;

  const response = market || teams ? await fetch(debugUrl, { cache: "no-store" }) : null;
  const payload = response?.ok ? ((await response.json()) as Record<string, unknown>) : null;
  const rows = Array.isArray(payload?.finalResults) ? (payload?.finalResults as Array<Record<string, unknown>>) : [];

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-6">
        <form className="grid gap-3 rounded-xl border border-slate-800 bg-slate-900/70 p-4 md:grid-cols-[10rem_minmax(0,1fr)_minmax(0,1fr)_auto]">
          <label className="grid gap-1 text-xs font-medium uppercase tracking-wide text-slate-400">
            Category
            <input className="h-10 rounded-md border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100" name="category" defaultValue={category} />
          </label>
          <label className="grid gap-1 text-xs font-medium uppercase tracking-wide text-slate-400">
            Market
            <input className="h-10 rounded-md border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100" name="market" defaultValue={market} />
          </label>
          <label className="grid gap-1 text-xs font-medium uppercase tracking-wide text-slate-400">
            Teams
            <input className="h-10 rounded-md border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100" name="teams" defaultValue={teams} />
          </label>
          <div className="flex items-end">
            <button className="h-10 rounded-md border border-cyan-500/40 bg-cyan-500/15 px-4 text-sm font-semibold text-cyan-100" type="submit">
              Load
            </button>
          </div>
        </form>

        {payload ? (
          <section className="grid gap-4">
            <div className="grid gap-4 md:grid-cols-2">
              <pre className="overflow-auto rounded-xl border border-slate-800 bg-slate-900/70 p-4 text-xs text-slate-200">{JSON.stringify({ extractedTeams: payload.extractedTeams, mappedOutcomes: payload.mappedOutcomes }, null, 2)}</pre>
              <pre className="overflow-auto rounded-xl border border-slate-800 bg-slate-900/70 p-4 text-xs text-slate-200">{JSON.stringify({ sportsMonksQueries: payload.sportsMonksQueries, sportsMonksMatches: payload.sportsMonksMatches, theSportsDbQueries: payload.theSportsDbQueries, theSportsDbMatches: payload.theSportsDbMatches }, null, 2)}</pre>
            </div>

            <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/70">
              <table className="w-full border-collapse text-left text-sm">
                <thead className="border-b border-slate-800 bg-slate-950/70 text-xs uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-3 py-2">Raw outcome</th>
                    <th className="px-3 py-2">Market team</th>
                    <th className="px-3 py-2">Matched Polymarket team</th>
                    <th className="px-3 py-2">Team id</th>
                    <th className="px-3 py-2">Abbrev</th>
                    <th className="px-3 py-2">Polymarket logo</th>
                    <th className="px-3 py-2">Final logo</th>
                    <th className="px-3 py-2">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr className="border-b border-slate-800/80 last:border-b-0" key={`${String(row.outcomeName ?? index)}-${index}`}>
                      <td className="max-w-52 px-3 py-2 align-top text-slate-100">{String(row.rawOutcomeLabel ?? row.outcomeName ?? "")}</td>
                      <td className="px-3 py-2 align-top text-slate-300">{String(row.matchedMarketTeam ?? row.canonicalTeam ?? "")}</td>
                      <td className="px-3 py-2 align-top text-slate-300">{row.matchedPolymarketTeam ? `${String((row.matchedPolymarketTeam as Record<string, unknown>).name ?? "")}` : ""}</td>
                      <td className="px-3 py-2 align-top text-slate-300">{row.matchedPolymarketTeam ? String((row.matchedPolymarketTeam as Record<string, unknown>).id ?? "") : ""}</td>
                      <td className="px-3 py-2 align-top text-slate-300">{row.matchedPolymarketTeam ? String((row.matchedPolymarketTeam as Record<string, unknown>).abbreviation ?? "") : ""}</td>
                      <td className="max-w-52 break-all px-3 py-2 align-top text-cyan-200">{String((row.matchedPolymarketTeam as Record<string, unknown> | null)?.logo ?? row.polymarketTeamLogoUrl ?? "")}</td>
                      <td className="max-w-52 break-all px-3 py-2 align-top text-cyan-100">{String(row.finalLogoUrl ?? row.logoUrl ?? "")}</td>
                      <td className="px-3 py-2 align-top text-slate-400">{String(row.providerReason ?? row.acceptedReason ?? row.rejectionReason ?? "")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : (
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 text-sm text-slate-400">Load a market and outcomes to inspect logo matching.</div>
        )}
      </div>
    </main>
  );
}
