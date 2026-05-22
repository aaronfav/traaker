import { NextResponse } from "next/server";
import { POLYMARKET_CLOB_URL } from "@/lib/polymarket/client";
import { buildL2Headers, getPolymarketServerCreds, isInvalidPolymarketAuthError } from "@/lib/server/polymarketAuth";
import { clearSession, getSession } from "@/lib/server/session";
import { logError, logInfo } from "@/lib/server/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function signedGet(path: string) {
  const headers = await buildL2Headers({ method: "GET", requestPath: path, route: "account" });
  const response = await fetch(`${POLYMARKET_CLOB_URL}${path}`, {
    method: "GET",
    headers,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error ?? `CLOB request failed (${response.status})`);
  return data;
}

export async function GET() {
  try {
    const creds = await getPolymarketServerCreds().catch(() => null);
    if (creds) {
      logInfo("api.polymarket.account", "account_request_started", {
        route: "account",
        clobHost: POLYMARKET_CLOB_URL,
        connectedWallet: creds.address,
        sessionWallet: creds.tradingWalletAddress ?? creds.address,
        apiKey: creds.key.slice(0, 6),
        signatureType: creds.signatureType ?? null,
        funderAddress: creds.tradingWalletAddress ?? null,
      });
    }
    const [balance, openOrders, trades] = await Promise.all([
      signedGet("/balance-allowance?asset_type=COLLATERAL"),
      signedGet("/data/orders"),
      signedGet("/data/trades"),
    ]);
    return NextResponse.json({ ok: true, balance, openOrders, trades }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logError("api.polymarket.account", error);
    const message = error instanceof Error ? error.message : "Unable to load Polymarket account data.";
    if (isInvalidPolymarketAuthError(message)) {
      try {
        const session = await getSession();
        clearSession(session);
      } catch {
        // ignore session cleanup failures
      }
      return NextResponse.json(
        {
          ok: false,
          code: "AUTH_INVALID_SESSION",
          error: "Polymarket session expired. Reinitializing trading session.",
          details: { message },
        },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }
    const sessionInvalid = /Trading session is not initialized/i.test(message);
    const configInvalid = /bytes32 hex string|POLYMARKET_(BUILDER_CODE|BUILDER_API_KEY|BUILDER_SECRET|BUILDER_PASSPHRASE|SESSION_SECRET)|POLYMARKET_RPC_URL is missing or invalid/i.test(message);
    return NextResponse.json(
      {
        ok: false,
        code: sessionInvalid ? "AUTH_INVALID_SESSION" : configInvalid ? "POLYMARKET_CONFIG_INVALID" : "POLYMARKET_ACCOUNT_UNAVAILABLE",
        error: sessionInvalid
          ? "Trading session is not initialized. Reconnect your wallet and approve the trading session prompt."
          : configInvalid
            ? "POLYMARKET configuration is missing or invalid."
            : "Unable to load Polymarket account data.",
        details: { message },
      },
      { status: sessionInvalid ? 401 : configInvalid ? 500 : 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
