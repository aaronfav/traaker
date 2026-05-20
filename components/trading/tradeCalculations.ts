export type TradeOrderType = "market" | "limit";

export type TradeCalculationInput = {
  price: number;
  quantity: number;
  limitPrice?: number;
  orderType: TradeOrderType;
  bestAsk?: number;
};

const safeNumber = (value: number, fallback = 0) => (Number.isFinite(value) ? value : fallback);
const clampPrice = (value: number) => Math.max(0.01, Math.min(0.99, safeNumber(value, 0.5)));

export function calculateTradeTicket(input: TradeCalculationInput) {
  const quantity = Math.max(0, safeNumber(input.quantity));
  const marketPrice = clampPrice(input.price);
  const executionPrice = input.orderType === "limit" ? clampPrice(input.limitPrice ?? marketPrice) : marketPrice;
  const cost = quantity * executionPrice;
  const estimatedPayout = quantity;
  const estimatedProfit = Math.max(0, estimatedPayout - cost);
  const slippageEstimate =
    input.orderType === "market" && Number.isFinite(input.bestAsk)
      ? Math.max(0, clampPrice(input.bestAsk as number) - marketPrice)
      : 0;

  return {
    avgPrice: executionPrice,
    cost,
    estimatedPayout,
    estimatedProfit,
    slippageEstimate,
  };
}

