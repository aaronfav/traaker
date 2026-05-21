import { OrderType, Side, type ClobClient } from "@polymarket/clob-client-v2";
import { afterEach, describe, expect, it, vi } from "vitest";
import { placeLimitOrder } from "@/lib/polymarket/orders";

const BUILDER_CODE = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const MAKER = "0x1111111111111111111111111111111111111111";
const SIGNER = "0x2222222222222222222222222222222222222222";

function signedOrder(tokenId: string, side: "BUY" | "SELL") {
  return {
    salt: "123",
    maker: MAKER,
    signer: SIGNER,
    taker: "0x0000000000000000000000000000000000000000",
    tokenID: tokenId,
    makerAmount: "1000000",
    takerAmount: "500000",
    side,
    signatureType: 2,
    timestamp: "1766789469",
    expiration: "0",
    metadata: "0x0000000000000000000000000000000000000000000000000000000000000000",
    builder: BUILDER_CODE,
    signature: `0x${"12".repeat(65)}`,
  };
}

function createClient() {
  const createOrder = vi.fn(async (order: { tokenID: string; side: Side }) => signedOrder(order.tokenID, order.side === Side.SELL ? "SELL" : "BUY"));
  return {
    client: { createOrder } as unknown as ClobClient,
    createOrder,
  };
}

async function submitCase(input: { tokenID: string; side: Side; price: number; size: number }) {
  const posted: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (inputUrl: RequestInfo | URL, init?: RequestInit) => {
      const url = String(inputUrl);
      if (url.includes("/api/polymarket/config")) {
        return new Response(JSON.stringify({ ok: true, builderCode: BUILDER_CODE }), { status: 200 });
      }
      posted.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ ok: true, data: { success: true } }), { status: 200 });
    }),
  );
  const { client, createOrder } = createClient();
  await placeLimitOrder(client, input);
  return { posted: posted[0] as Record<string, unknown>, createOrder };
}

describe("Polymarket order routing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("routes a buy for a selected aggregated outcome with tokenID and builder attribution", async () => {
    const { posted, createOrder } = await submitCase({ tokenID: "111111", side: Side.BUY, price: 0.59, size: 10 });

    expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({ tokenID: "111111", side: Side.BUY, price: 0.59, size: 10, builderCode: BUILDER_CODE }), expect.any(Object));
    expect(posted).toMatchObject({
      tradeMode: "limit",
      execution: OrderType.GTC,
      orderType: OrderType.GTC,
      order: { tokenId: "111111", side: "BUY", builder: BUILDER_CODE },
    });
  });

  it("routes a sell for a selected aggregated outcome with the same selected tokenID", async () => {
    const { posted, createOrder } = await submitCase({ tokenID: "222221", side: Side.SELL, price: 0.43, size: 5 });

    expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({ tokenID: "222221", side: Side.SELL, price: 0.43, size: 5, builderCode: BUILDER_CODE }), expect.any(Object));
    expect(posted).toMatchObject({
      order: { tokenId: "222221", side: "SELL", builder: BUILDER_CODE },
    });
  });

  it("routes a buy for a binary matchup tokenID", async () => {
    const { posted, createOrder } = await submitCase({ tokenID: "101", side: Side.BUY, price: 0.57, size: 12 });

    expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({ tokenID: "101", side: Side.BUY, price: 0.57, size: 12, builderCode: BUILDER_CODE }), expect.any(Object));
    expect(posted).toMatchObject({
      order: { tokenId: "101", side: "BUY", builder: BUILDER_CODE },
    });
  });

  it("routes a sell for a binary matchup tokenID", async () => {
    const { posted, createOrder } = await submitCase({ tokenID: "202", side: Side.SELL, price: 0.45, size: 7 });

    expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({ tokenID: "202", side: Side.SELL, price: 0.45, size: 7, builderCode: BUILDER_CODE }), expect.any(Object));
    expect(posted).toMatchObject({
      order: { tokenId: "202", side: "SELL", builder: BUILDER_CODE },
    });
  });
});
