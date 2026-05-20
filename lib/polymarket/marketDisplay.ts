import type { TerminalMarket } from "@/lib/polymarket/types";

export const USEFUL_FAVORED_PRICE_MIN = 0.11;
export const USEFUL_FAVORED_PRICE_MAX = 0.94;

const finitePrice = (value: number) => (Number.isFinite(value) ? value : 0);

export function getFavoredMarketPrice(market: Pick<TerminalMarket, "yesPrice" | "noPrice">) {
  return Math.max(finitePrice(market.yesPrice), finitePrice(market.noPrice));
}

export function isUsefulFavoredPrice(price: number) {
  return Number.isFinite(price) && price >= USEFUL_FAVORED_PRICE_MIN && price <= USEFUL_FAVORED_PRICE_MAX;
}

export function hasUsefulFavoredPrice(market: Pick<TerminalMarket, "yesPrice" | "noPrice">) {
  return isUsefulFavoredPrice(getFavoredMarketPrice(market));
}

