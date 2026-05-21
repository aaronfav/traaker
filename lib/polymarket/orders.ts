import { OrderType, Side, type ClobClient, type SignedOrder } from "@polymarket/clob-client-v2";
import { assertBuilderCodeReady, assertSignedOrderBuilder } from "./assertBuilderAttribution";
import { getBuilderCode } from "./client";
import { normalizeSignedOrder, type NormalizedSignedOrder } from "./normalizeSignedOrder";
import { validateTrade, type TradeValidationInput } from "./validation";

type LimitOrderInput = {
  tokenID: string;
  price: number;
  size: number;
  side?: Side;
  tickSize?: "0.1" | "0.01" | "0.001" | "0.0001";
  negRisk?: boolean;
  userUSDCBalance?: number;
  builderCode?: string;
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
  builderCode?: string;
};

type ConfigResponse = {
  ok?: boolean;
  builderCode?: string;
  error?: string;
};

async function safeJson<T>(response: Response): Promise<T | null> {
  const text = await response.text().catch(() => "");
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export async function fetchBuilderCode() {
  const localBuilderCode = getBuilderCode();
  if (localBuilderCode) return assertBuilderCodeReady(localBuilderCode);

  const response = await fetch("/api/polymarket/config", {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const data = await safeJson<ConfigResponse>(response);
  if (!response.ok || !data?.ok || !data.builderCode) {
    throw new Error(data?.error ?? "Polymarket builder code is not configured.");
  }
  return assertBuilderCodeReady(data.builderCode);
}

export async function placeLimitOrder(client: ClobClient, input: LimitOrderInput) {
  const builderCode = assertBuilderCodeReady(input.builderCode ?? (await fetchBuilderCode()));

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
  const normalized = normalizeSignedOrder(signedOrder);
  assertSignedOrderBuilder(normalized.builder, builderCode);
  return submitSignedOrder({ order: normalized, orderType: OrderType.GTC });
}

export async function placeMarketOrder(client: ClobClient, input: MarketOrderInput) {
  const builderCode = assertBuilderCodeReady(input.builderCode ?? (await fetchBuilderCode()));
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
  const normalized = normalizeSignedOrder(signedOrder);
  assertSignedOrderBuilder(normalized.builder, builderCode);
  return submitSignedOrder({ order: normalized, orderType: input.orderType ?? OrderType.FOK });
}

export async function submitSignedOrder(input: { order: SignedOrder | NormalizedSignedOrder; orderType: OrderType; tradeMode?: "limit" | "market"; signatureType?: number; funderAddress?: string; authAddress?: string; clientMeta?: Record<string, unknown> }) {
  const response = await fetch("/api/polymarket/order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tradeMode: input.tradeMode ?? (input.orderType === OrderType.GTC || input.orderType === OrderType.GTD ? "limit" : "market"),
      execution: input.orderType,
      order: input.order,
      orderType: input.orderType,
      ...(input.signatureType != null ? { signatureType: input.signatureType } : {}),
      ...(input.funderAddress ? { funderAddress: input.funderAddress } : {}),
      ...(input.authAddress ? { authAddress: input.authAddress } : {}),
      ...(input.clientMeta ? { clientMeta: input.clientMeta } : {}),
    }),
  });
  const data = await safeJson<{ ok?: boolean; error?: string; message?: string; details?: unknown }>(response);
  if (!response.ok || data?.ok === false) {
    const message = data?.error ?? data?.message ?? "Polymarket order submission failed.";
    const haystack = `${message} ${data?.details ? JSON.stringify(data.details) : ""}`;
    if (/invalid authorization/i.test(haystack)) {
      throw new Error("Polymarket authorization expired. Retry the order after refreshing credentials.");
    }
    if (/maker address not allowed|deposit wallet flow|deposit wallet required/i.test(haystack)) {
      throw new Error("This account must trade through a Polymarket deposit wallet. Deploy or fund the deposit wallet before trading.");
    }
    throw new Error(message);
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
