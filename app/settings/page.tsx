import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { POLYMARKET_HOST, getBuilderCode } from "@/lib/polymarket/client";

export default function SettingsPage() {
  const builderCode = getBuilderCode();

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <p className="text-sm uppercase tracking-[0.24em] text-cyan-200/80">Builder settings</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-50">Polymarket configuration</h1>

      <section className="mt-8 grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Builder code</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="break-all rounded-md border border-slate-800 bg-slate-900 p-3 font-mono text-sm text-slate-100">
              {builderCode || "NEXT_PUBLIC_POLY_BUILDER_CODE is not set"}
            </p>
            <p className="mt-2 text-sm text-slate-400">Orders pass this value as builderCode through the CLOB V2 client.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>API connection</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Badge tone="green">CLOB V2</Badge>
              <Badge tone="cyan">Polygon chainId 137</Badge>
              <Badge tone="slate">{POLYMARKET_HOST}</Badge>
            </div>
            <p className="text-sm text-slate-400">
              Market pages use public CLOB endpoints with mock fallback. Trading and portfolio calls derive wallet-scoped API credentials client-side.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Wallet status</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-slate-400">
              Use the wallet button in the header to connect. Deposit wallet and session signer flows are marked with TODOs for production hardening.
            </p>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
