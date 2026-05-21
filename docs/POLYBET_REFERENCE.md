# Polybet Reference Notes

Polybet was inspected read-only. No files under `C:\Users\Emmanuel\Polybet` were modified.

## Files Inspected

- `src/lib/polymarket/api.ts`
- `src/lib/polymarket/types.ts`
- `src/lib/polymarket/category.ts`
- `src/lib/polymarket/marketStatus.ts`
- `src/lib/polymarket/clob.ts`
- `src/lib/polymarket/clobClientFactory.ts`
- `src/lib/polymarket/tradeService.ts`
- `src/lib/polymarket/assertBuilderAttribution.ts`
- `src/lib/server/polymarketRuntimeConfig.ts`
- `src/lib/server/polymarketHeaders.ts`
- `src/lib/server/polymarketOrderHandler.ts`
- `src/app/api/markets/route.ts`
- `src/app/api/polymarket/config/route.ts`
- `src/app/api/polymarket/order/route.ts`

## Market Fetching Flow

Traak now follows Polybet conceptually:

1. Fetch Gamma `/events` with `closed=false`, `order=id`, `ascending=false`, `limit=200`, and paginated `offset`.
2. Flatten event `markets`.
3. Carry event tags onto each market when market tags are missing.
4. Parse `outcomes`, `outcomePrices`, and `clobTokenIds` from JSON strings.
5. Filter out closed, resolved, archived, inactive, non-orderbook, and non-sports markets.
6. Identify sports markets from tags, category, slug tokens, and matchup/title cues.
7. Enrich top-of-book from CLOB where available.

Supported sports include NBA, NFL, Soccer, UFC/MMA, Tennis, MLB, NHL, and NCAA.

## Order Auth Flow

Traak now follows Polybet’s credential separation:

1. Browser wallet signs the order through CLOB client order creation.
2. `builderCode` is fetched from Traak's server config route before signing.
3. The signed order is posted to a Traak server route.
4. The server validates the signed `order.builder` equals configured builder code.
5. The server posts to CLOB `/order` with L2 HMAC headers built from server-only credentials.

## Required Env

- `POLYMARKET_BUILDER_CODE`
- `POLYMARKET_HOST`
- `POLYMARKET_ADDRESS`
- `POLYMARKET_API_KEY`
- `POLYMARKET_SECRET`
- `POLYMARKET_PASSPHRASE`
- `POLYGON_RPC_URL`

Existing Traak database/admin env vars remain only for existing portfolio persistence/admin routes.

## Not Copied

- Polybet’s iron-session user-derived L2 credential storage was not copied.
- Polybet’s relayer submit/deploy flow was not wired into Traak.
- Polybet files were not modified.
