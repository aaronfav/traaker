import { MarketsExplorer } from "@/components/MarketsExplorer";
import { createEmptyMarketPage } from "@/lib/polymarket/markets";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const initialPage = createEmptyMarketPage();

  return (
    <main className="w-full overflow-hidden bg-[#05070d]">
      <MarketsExplorer
        initialPage={initialPage}
        source="polymarket"
      />
    </main>
  );
}
