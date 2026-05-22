import { NextResponse, type NextRequest } from "next/server";
import { AssetType, Chain, ClobClient, type ApiKeyCreds, type BalanceAllowanceParams, type SignatureTypeV2 } from "@polymarket/clob-client-v2";
import { clearSession, getSession, isSessionExpired } from "@/lib/server/session";
import { logError, logInfo } from "@/lib/server/logger";
import { isInvalidPolymarketAuthError } from "@/lib/server/polymarketAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const CLOB_HOST = process.env.POLYMARKET_CLOB_URL ?? process.env.POLYMARKET_HOST ?? "https://clob.polymarket.com";
const ASSET_TYPES = new Set(["COLLATERAL", "CONDITIONAL"]);
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

const sameAddress = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

const normalizeAddress = (value: unknown) => (typeof value === "string" && ADDRESS_RE.test(value) ? value : null);

const createAddressOnlySigner = (address: string) => ({
  getAddress: async () => address,
  _signTypedData: async () => {
    throw new Error("This signer only supports CLOB allowance sync.");
  },
});

const parseBody = async (request: NextRequest) => {
  const text = await request.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const buildClobClient = ({
  walletAddress,
  creds,
  signatureType,
  tradingWalletAddress,
}: {
  walletAddress: string;
  creds: ApiKeyCreds;
  signatureType: number;
  tradingWalletAddress: string;
}) =>
  new ClobClient({
    host: CLOB_HOST,
    chain: Chain.POLYGON,
    signer: createAddressOnlySigner(walletAddress) as never,
    creds,
    signatureType: signatureType as SignatureTypeV2,
    funderAddress: tradingWalletAddress,
    retryOnError: true,
  });

const hasCompleteCreds = (creds: ApiKeyCreds | null) => Boolean(creds?.key && creds.secret && creds.passphrase);

export async function POST(request: NextRequest) {
  const body = await parseBody(request);
  if (!body) {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const assetType = typeof body.assetType === "string" ? body.assetType : typeof body.asset_type === "string" ? body.asset_type : "COLLATERAL";
  const tokenId = typeof body.tokenId === "string" ? body.tokenId : typeof body.token_id === "string" ? body.token_id : null;
  const signatureType = Number(body.signatureType ?? body.signature_type);
  const tradingWalletAddress = normalizeAddress(body.tradingWalletAddress ?? body.funderAddress ?? body.funder);
  const connectedEoa = normalizeAddress(body.connectedEoa ?? body.authAddress);

  if (!ASSET_TYPES.has(assetType)) {
    return NextResponse.json({ ok: false, error: "assetType must be COLLATERAL or CONDITIONAL." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  if (!Number.isInteger(signatureType) || (signatureType !== 2 && signatureType !== 3)) {
    return NextResponse.json({ ok: false, error: "signatureType must be 2 for proxy/Safe or 3 for deposit wallet trading." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  if (!tradingWalletAddress) {
    return NextResponse.json({ ok: false, error: "tradingWalletAddress is required." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  let session: Awaited<ReturnType<typeof getSession>>;
  try {
    session = await getSession();
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Server session not configured." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (isSessionExpired(session) || !session.l2 || !session.walletAddress) {
    return NextResponse.json(
      {
        ok: false,
        code: "AUTH_INVALID_SESSION",
        error: "Trading session is not initialized. Reconnect your wallet and approve the trading session prompt.",
      },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const allowanceParams: BalanceAllowanceParams = {
    asset_type: assetType === AssetType.CONDITIONAL ? AssetType.CONDITIONAL : AssetType.COLLATERAL,
    ...(tokenId ? { token_id: tokenId } : {}),
  };
  const creds: ApiKeyCreds = {
    key: session.l2.apiKey,
    secret: session.l2.secret,
    passphrase: session.l2.passphrase,
  };

  logInfo("api.polymarket.balance_allowance", "balance_allowance_update_requested", {
    route: "balance-allowance/update",
    connectedEoa: connectedEoa ?? session.walletAddress ?? null,
    signatureType,
    walletType: signatureType === 2 ? "legacy-proxy" : "deposit-wallet",
    tradingWalletAddress,
    assetType,
    tokenIdPrefix: tokenId?.slice(0, 12) ?? null,
    hasApiCreds: hasCompleteCreds(creds),
  });

  try {
    const clobClient = buildClobClient({
      walletAddress: session.walletAddress,
      creds,
      signatureType,
      tradingWalletAddress,
    });
    const update = await clobClient.updateBalanceAllowance(allowanceParams);
    const balanceAllowance = await clobClient.getBalanceAllowance(allowanceParams);
    logInfo("api.polymarket.balance_allowance", "balance_allowance_sync_completed", {
      route: "balance-allowance/update",
      connectedEoa: connectedEoa ?? session.walletAddress ?? null,
      signatureType,
      walletType: signatureType === 2 ? "legacy-proxy" : "deposit-wallet",
      tradingWalletAddress,
      assetType,
      tokenIdPrefix: tokenId?.slice(0, 12) ?? null,
      updateRan: true,
      balanceAllowanceLoaded: true,
    });
    if (connectedEoa && !sameAddress(connectedEoa, session.walletAddress)) {
      logInfo("api.polymarket.balance_allowance", "connected_eoa_mismatch", {
        connectedEoa,
        serverAddress: session.walletAddress,
      });
    }
    return NextResponse.json(
      {
        ok: true,
        data: { update, balanceAllowance },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    logError("api.polymarket.balance_allowance", error);
    if (isInvalidPolymarketAuthError(error)) {
      try {
        clearSession(session);
      } catch {
        // ignore session cleanup failures
      }
      return NextResponse.json(
        {
          ok: false,
          code: "AUTH_INVALID_SESSION",
          error: "Polymarket session expired. Reinitializing trading session.",
        },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Balance allowance update failed.",
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
