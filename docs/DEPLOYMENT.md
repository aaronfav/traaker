# Traak Deployment

## GitHub Push Flow

```bash
git status --short
git add .
git commit -m "Prepare production deployment"
git push origin main
```

Use a feature branch if `main` is protected:

```bash
git checkout -b production-readiness
git add .
git commit -m "Prepare production deployment"
git push -u origin production-readiness
```

## Vercel Import Flow

1. Open Vercel and import the GitHub repository.
2. Set Framework Preset to Next.js.
3. Use the repository root as the Root Directory.
4. Keep the install command as `npm install`.
5. Keep the build command as `npm run build`.
6. Deploy after environment variables are configured.

## Environment Variables

Required:

```bash
NEXT_PUBLIC_POLY_BUILDER_CODE="0xYOUR_BYTES32_BUILDER_CODE"
POLYMARKET_HOST="https://clob.polymarket.com"
POLYMARKET_ADDRESS="0xYOUR_POLYMARKET_AUTH_ADDRESS"
POLYMARKET_API_KEY="your-server-l2-api-key"
POLYMARKET_SECRET="your-server-l2-secret"
POLYMARKET_PASSPHRASE="your-server-l2-passphrase"
POLYGON_RPC_URL="https://polygon-rpc.com"
ENABLE_REAL_TRADING="false"
```

Optional:

```bash
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID="your-reown-project-id"
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DB_NAME?schema=public"
ADMIN_TOKEN="replace-with-a-strong-token"
```

Do not add `.env`, `.env.local`, or `.env.production` to git. Configure production values in Vercel Project Settings -> Environment Variables.

## Reown Allowlist

If `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is set, add the Vercel production domain and any custom production domain to the Reown project allowlist before testing wallet connections. Localhost works without this variable through injected-wallet fallback.

## Trading Rollout

Keep `ENABLE_REAL_TRADING=false` for the first deployment. In this mode, the UI allows dry-run validation and the server rejects order and cancel mutations.

Before enabling live trading:

1. Verify market browsing and wallet connection on production.
2. Verify `/api/polymarket/config` returns the expected builder code.
3. Verify dry-run trade validation from the trade ticket.
4. Set `ENABLE_REAL_TRADING=true` only after those checks pass.
5. Test with a tiny limit order on a highly liquid market.
6. Confirm the order appears in Polymarket account data.
7. Test cancellation with a tiny open limit order.

## Production Checks

Run before pushing:

```bash
npm run lint
npx tsc --noEmit
npm run build
npm run test
```
