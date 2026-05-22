import { afterEach, describe, expect, it, vi } from "vitest";

type MockSession = {
  l2?: {
    apiKey: string;
    secret: string;
    passphrase: string;
  };
  walletAddress?: string;
  tradingWalletAddress?: string;
  signatureType?: number;
  createdAt?: number;
  save: () => Promise<void>;
  destroy: () => void;
};

const sessionState = vi.hoisted(() => ({
  session: {
    l2: {
      apiKey: "session-api-key",
      secret: "c2Vzc2lvbi1zZWNyZXQ=",
      passphrase: "session-passphrase",
    },
    walletAddress: "0x1111111111111111111111111111111111111111",
    tradingWalletAddress: "0x2222222222222222222222222222222222222222",
    signatureType: 3,
    createdAt: Date.now(),
    save: vi.fn(async () => undefined),
    destroy: vi.fn(),
  } as MockSession,
}));

vi.mock("@/lib/server/session", () => ({
  getSession: vi.fn(async () => sessionState.session),
  isSessionExpired: vi.fn(() => false),
  clearSession: vi.fn(),
}));

describe("Polymarket session-backed account route", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("reads account data with the active session wallet headers", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | Headers | undefined;
      const headerRecord =
        headers instanceof Headers
          ? Object.fromEntries(headers.entries())
          : (headers ?? {});
      expect(headerRecord.POLY_ADDRESS).toBe("0x1111111111111111111111111111111111111111");
      expect(headerRecord.POLY_API_KEY).toBe("session-api-key");
      expect(headerRecord.POLY_PASSPHRASE).toBe("session-passphrase");
      return new Response(JSON.stringify({ balance: { balance: "1000000", allowances: {} }, openOrders: [], trades: [] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { GET } = await import("@/app/api/polymarket/account/route");
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("clears the session and returns AUTH_INVALID_SESSION when Polymarket rejects the api key", async () => {
    const { clearSession } = await import("@/lib/server/session");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: "Unauthorized/Invalid api key" }), { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    const { GET } = await import("@/app/api/polymarket/account/route");
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.code).toBe("AUTH_INVALID_SESSION");
    expect(body.error).toMatch(/session expired/i);
    expect(clearSession).toHaveBeenCalled();
  });
});
