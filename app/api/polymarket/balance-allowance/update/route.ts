import { NextResponse, type NextRequest } from "next/server";
import { AssetType, Chain, ClobClient, type ApiKeyCreds, type BalanceAllowanceParams, type SignatureTypeV2 } from "@polymarket/clob-client-v2";
import { getPolymarketServerCreds } from "@/lib/server/polymarketAuth";
import { logError, logInfo } from "@/lib/server/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const CLOB_HOST = process.env.POLYMARKET_HOST ?? "https://clob.polymarket.com";
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

const hasCompleteCreds = (creds: ReturnType<typeof getPolymarketServerCreds> | null) => Boolean(creds?.key && creds.secret && creds.passphrase);

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
    return NextResponse.json({ ok: false, error: "signatureType must be 2 for proxy/Safe or 3 for deposit wallet." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  if (!tradingWalletAddress) {
    return NextResponse.json({ ok: false, error: "tradingWalletAddress is required." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  let creds;
  try {
    creds = getPolymarketServerCreds();
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Missing Polymarket CLOB credentials." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }

  const allowanceParams: BalanceAllowanceParams = {
    asset_type: assetType === AssetType.CONDITIONAL ? AssetType.CONDITIONAL : AssetType.COLLATERAL,
    ...(tokenId ? { token_id: tokenId } : {}),
  };

  logInfo("api.polymarket.balance_allowance", "balance_allowance_update_requested", {
    connectedEoa: connectedEoa ?? null,
    signatureType,
    tradingWalletAddress,
    assetType,
    tokenIdPrefix: tokenId?.slice(0, 12) ?? null,
    hasApiCreds: hasCompleteCreds(creds),
  });

  try {
    const clobClient = buildClobClient({
      walletAddress: creds.address,
      creds,
      signatureType,
      tradingWalletAddress,
    });
    const update = await clobClient.updateBalanceAllowance(allowanceParams);
    const balanceAllowance = await clobClient.getBalanceAllowance(allowanceParams);
    if (connectedEoa && !sameAddress(connectedEoa, creds.address)) {
      logInfo("api.polymarket.balance_allowance", "connected_eoa_mismatch", {
        connectedEoa,
        serverAddress: creds.address,
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
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Balance allowance update failed.",
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
