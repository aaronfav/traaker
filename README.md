# Traak Sports Terminal

Next.js + TypeScript MVP for browsing and trading Polymarket sports markets through the CLOB V2 API.

## Features

- Dashboard at `/` with trending, volume, mover, liquidity, live, and upcoming sports market views.
- Market detail pages at `/markets/[id]` with prices, implied probability, chart, orderbook depth, recent trades, and analytics scores.
- Trading page at `/trade/[id]` with buy YES/NO, amount, limit price, slippage protection, review modal, and CLOB order submission.
- Portfolio page at `/portfolio` with connected wallet, deposit wallet placeholder, USDC/pUSD balance, open positions, open orders, trade history, and PnL placeholder.
- Settings page at `/settings` with builder code, CLOB host, Polygon chain status, and wallet notes.
- Mock fallback data when Polymarket public or authenticated API calls fail.

## Stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- shadcn-style local UI primitives
- wagmi + RainbowKit
- viem
- `@polymarket/clob-client-v2`
- Recharts

## Environment

Create `.env` from `.env.example` and set:

```bash
NEXT_PUBLIC_POLY_BUILDER_CODE="0xYOUR_BYTES32_BUILDER_CODE"
POLYMARKET_HOST="https://clob.polymarket.com"
POLYMARKET_ADDRESS="0xYOUR_POLYMARKET_AUTH_ADDRESS"
POLYMARKET_API_KEY="your-server-l2-api-key"
POLYMARKET_SECRET="your-server-l2-secret"
POLYMARKET_PASSPHRASE="your-server-l2-passphrase"
POLYGON_RPC_URL="https://polygon-rpc.com"
ENABLE_REAL_TRADING="false"
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=""
```

`NEXT_PUBLIC_POLY_BUILDER_CODE` must be the bytes32 builder code issued for your Polymarket builder integration. The order helpers pass it as `builderCode` on every limit and marketable order.

`POLYMARKET_ADDRESS`, `POLYMARKET_API_KEY`, `POLYMARKET_SECRET`, and `POLYMARKET_PASSPHRASE` are server-only CLOB L2 auth values used to post signed orders and read account state. They are never exposed to browser code.

`POLYGON_RPC_URL` should point at a reliable Polygon mainnet RPC. The UI and trading flow enforce Polygon `chainId 137`.

`ENABLE_REAL_TRADING` defaults to disabled unless explicitly set to `true`. With the default `false`, the trade ticket runs dry-run validation only and server order/cancel routes reject live CLOB mutations.

`NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is optional. When unset, Traak falls back to injected browser wallets only; set it before enabling WalletConnect/Reown in production.

Existing persistence/admin variables are still supported for the older portfolio import routes:

```bash
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DB_NAME?schema=public"
ADMIN_TOKEN="replace-with-a-strong-token"
DEV_ADMIN_TOKEN="set-for-local-dev-sync-button"
```

## Local Setup

```bash
npm install
npm run prisma:generate
npm run dev
```

Open `http://localhost:3000`.

## Real vs Fallback Data

Real:

- Active sports market discovery uses paginated Polymarket Gamma `/events` and flattens event markets.
- Orderbooks, price history, recent trades, open orders, trades, balances, and allowances use CLOB V2 where available.
- Deposit wallet address is derived and checked for deployed bytecode, but relayer deployment is not wired into Traak.

Fallback:

- Mock sports markets, charts, orderbook, trades, positions, and PnL are used only when Polymarket APIs fail or authenticated wallet data is unavailable.
- PnL remains a placeholder until production fill reconciliation is implemented.

## Trading Notes

- The app is configured for Polygon mainnet, `chainId 137`.
- Trading uses Polymarket CLOB V2 through `@polymarket/clob-client-v2`.
- New signer clients default to `SignatureTypeV2.POLY_1271` for deposit-wallet style users.
- Orders include:

```ts
builderCode: process.env.NEXT_PUBLIC_POLY_BUILDER_CODE
```

- Limit orders are signed in the browser with `createOrder`, then posted by the server route with L2 credentials.
- Marketable orders are signed in the browser with `createMarketOrder`, then posted by the server route with slippage-derived protected price and `OrderType.FOK` by default.
- Funds are never custodied by this app. Orders are signed by the connected wallet and posted to Polymarket.
- Server-side CLOB L2 credentials post signed orders and read account state. The browser signs orders with the connected wallet and public builder code only.
- Server routes validate public market/order-validation inputs with Zod. Server-side private credential storage is intentionally not added.
- Simulation mode is displayed but disabled in production so users cannot mistake a dry run for a submitted CLOB order.

## Example: Limit Order With Builder Code

```ts
import { createSignerClient, SignatureTypeV2 } from "@/lib/polymarket/client";
import { placeLimitOrder, Side } from "@/lib/polymarket/orders";

const client = await createSignerClient({
  signer: walletClient,
  signatureType: SignatureTypeV2.POLY_1271,
});

await placeLimitOrder(client, {
  tokenID: "POLYMARKET_OUTCOME_TOKEN_ID",
  price: 0.57,
  size: 25,
  side: Side.BUY,
});
```

## Example: Marketable FOK Order

```ts
import { createSignerClient, SignatureTypeV2 } from "@/lib/polymarket/client";
import { OrderType, placeMarketOrder, Side } from "@/lib/polymarket/orders";

const client = await createSignerClient({
  signer: walletClient,
  signatureType: SignatureTypeV2.POLY_1271,
});

await placeMarketOrder(client, {
  tokenID: "POLYMARKET_OUTCOME_TOKEN_ID",
  amount: 100,
  currentPrice: 0.57,
  maxSlippageBps: 100,
  orderType: OrderType.FOK,
  side: Side.BUY,
});
```

## Production Hardening TODOs

- Keep deposit-wallet relayer onboarding optional and separated from basic CLOB order posting.
- If user-derived L2 sessions are later added, store them only in encrypted, wallet-scoped server sessions.
- Replace mock PnL with position/fill reconciliation from Polymarket account data.
- Add more robust sports categorization from Gamma/event metadata if a richer market discovery feed is desired.
- Add production approval/setup transactions for missing USDC, pUSD, exchange, and CTF allowances.
- Add monitoring for Gamma/CLOB latency, rate limits, and order-posting errors.
