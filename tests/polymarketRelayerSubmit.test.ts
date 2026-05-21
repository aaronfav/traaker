import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const builderHeaders = {
  POLY_BUILDER_API_KEY: "builder-key",
  POLY_BUILDER_SIGNATURE: "builder-signature",
  POLY_BUILDER_TIMESTAMP: "1710000000",
  POLY_BUILDER_PASSPHRASE: "builder-passphrase",
};

vi.mock("@polymarket/builder-signing-sdk", () => ({
  BuilderSigner: vi.fn().mockImplementation(() => ({
    createBuilderHeaderPayload: vi.fn(() => builderHeaders),
  })),
}));

describe("/api/polymarket/submit", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("returns a gasless-only error when builder credentials are missing", async () => {
    vi.stubEnv("POLYMARKET_BUILDER_API_KEY", "");
    vi.stubEnv("POLYMARKET_BUILDER_SECRET", "");
    vi.stubEnv("POLYMARKET_BUILDER_PASSPHRASE", "");
    vi.stubEnv("POLYMARKET_RPC_URL", "https://polygon-rpc.example");

    const { POST } = await import("@/app/api/polymarket/submit/route");
    const response = await POST(
      new NextRequest("http://localhost/api/polymarket/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "GASLESS_TRADING_NOT_CONFIGURED",
      error: expect.stringContaining("Builder relayer credentials are missing"),
    });
  });

  it("forwards relayer submit requests with builder auth headers", async () => {
    vi.stubEnv("POLYMARKET_BUILDER_API_KEY", "builder-key");
    vi.stubEnv("POLYMARKET_BUILDER_SECRET", "builder-secret");
    vi.stubEnv("POLYMARKET_BUILDER_PASSPHRASE", "builder-passphrase");

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ transactionID: "tx-1", state: "STATE_NEW" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("@/app/api/polymarket/submit/route");
    const response = await POST(
      new NextRequest("http://localhost/api/polymarket/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "WALLET-CREATE",
          from: "0x1111111111111111111111111111111111111111",
          to: "0x00000000000Fb5C9ADea0298D729A0CB3823Cc07",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestInit = ((fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit?] | undefined)?.[1]) ?? null;
    expect(requestInit).toMatchObject({
      method: "POST",
      headers: expect.objectContaining(builderHeaders),
    });
  });
});
