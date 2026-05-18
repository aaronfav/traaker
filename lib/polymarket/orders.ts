import { OrderType, Side, type ClobClient, type SignedOrder } from "@polymarket/clob-client-v2";
import { getBuilderCode } from "./client";
import { validateTrade, type TradeValidationInput } from "./validation";

type LimitOrderInput = {
  tokenID: string;
  price: number;
  size: number;
  side?: Side;
  tickSize?: "0.1" | "0.01" | "0.001" | "0.0001";
  negRisk?: boolean;
  userUSDCBalance?: number;
};

type MarketOrderInput = {
  tokenID: string;
  amount: number;
  side?: Side;
  maxSlippageBps: number;
  currentPrice: number;
  orderType?: OrderType.FOK | OrderType.FAK;
  tickSize?: "0.1" | "0.01" | "0.001" | "0.0001";
  negRisk?: boolean;
  userUSDCBalance?: number;
};

export async function placeLimitOrder(client: ClobClient, input: LimitOrderInput) {
  const builderCode = getBuilderCode();

  const signedOrder = await client.createOrder(
    {
      tokenID: input.tokenID,
      price: input.price,
      size: input.size,
      side: input.side ?? Side.BUY,
      builderCode,
      userUSDCBalance: input.userUSDCBalance,
    },
    { tickSize: input.tickSize ?? "0.01", negRisk: input.negRisk },
  );
  return submitSignedOrder({ order: signedOrder, orderType: OrderType.GTC });
}

export async function placeMarketOrder(client: ClobClient, input: MarketOrderInput) {
  const builderCode = getBuilderCode();
  const slippage = input.maxSlippageBps / 10_000;
  const protectedPrice =
    (input.side ?? Side.BUY) === Side.BUY
      ? Math.min(0.99, input.currentPrice * (1 + slippage))
      : Math.max(0.01, input.currentPrice * (1 - slippage));

  const signedOrder = await client.createMarketOrder(
    {
      tokenID: input.tokenID,
      amount: input.amount,
      price: protectedPrice,
      side: input.side ?? Side.BUY,
      orderType: input.orderType ?? OrderType.FOK,
      builderCode,
      userUSDCBalance: input.userUSDCBalance,
    },
    { tickSize: input.tickSize ?? "0.01", negRisk: input.negRisk },
  );
  return submitSignedOrder({ order: signedOrder, orderType: input.orderType ?? OrderType.FOK });
}

export async function submitSignedOrder(input: { order: SignedOrder; orderType: OrderType }) {
  const response = await fetch("/api/polymarket/order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.error ?? "Polymarket order submission failed.");
  }
  return data;
}

export async function cancelOrder(orderId: string) {
  const response = await fetch("/api/polymarket/order/cancel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.error ?? "Unable to cancel order.");
  }
  return data;
}

export async function getOpenOrders(client: ClobClient, market?: string) {
  return client.getOpenOrders(market ? { market } : undefined);
}

export async function getTradeHistory(client: ClobClient, market?: string) {
  return client.getTrades(market ? { market } : undefined);
}

export { validateTrade };
export type { TradeValidationInput };
export { OrderType, Side };
