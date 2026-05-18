import { AssetType, type ClobClient } from "@polymarket/clob-client-v2";
import { mockPositions } from "./mock";
import type { AllowanceState, PortfolioBalanceState, Position } from "./types";

function normalizeAllowance(raw: { balance: string; allowances: Record<string, string> }): AllowanceState {
  const allowanceEntries = Object.entries(raw.allowances ?? {});
  const exchange = allowanceEntries.find(([key]) => key.toLowerCase().includes("exchange"))?.[1] ?? allowanceEntries[0]?.[1] ?? null;
  const ctf = allowanceEntries.find(([key]) => key.toLowerCase().includes("conditional"))?.[1] ?? allowanceEntries[1]?.[1] ?? null;

  const hasAllowance = (value: string | null) => {
    try {
      return value !== null && BigInt(value) > BigInt(0);
    } catch {
      return false;
    }
  };

  return {
    balance: Number(raw.balance) / 1_000_000,
    rawBalance: raw.balance,
    allowances: raw.allowances ?? {},
    exchangeAllowance: exchange,
    ctfAllowance: ctf,
    hasExchangeAllowance: hasAllowance(exchange),
    hasCtfAllowance: hasAllowance(ctf),
  };
}

const emptyAllowance: AllowanceState = {
  balance: 0,
  rawBalance: "0",
  allowances: {},
  exchangeAllowance: null,
  ctfAllowance: null,
  hasExchangeAllowance: false,
  hasCtfAllowance: false,
};

export async function getBalance(client?: ClobClient, conditionalTokenId?: string): Promise<PortfolioBalanceState> {
  if (!client) return { usdc: emptyAllowance, pUsd: emptyAllowance, conditional: null, source: "mock" as const };

  try {
    const collateral = await client.getBalanceAllowance({ asset_type: AssetType.COLLATERAL });
    const conditional = conditionalTokenId
      ? await client.getBalanceAllowance({ asset_type: AssetType.CONDITIONAL, token_id: conditionalTokenId })
      : null;

    return {
      usdc: normalizeAllowance(collateral),
      pUsd: normalizeAllowance(collateral),
      conditional: conditional ? normalizeAllowance(conditional) : null,
      source: "polymarket" as const,
    };
  } catch {
    return { usdc: emptyAllowance, pUsd: emptyAllowance, conditional: null, source: "mock" as const };
  }
}

export async function getPositions(): Promise<Position[]> {
  // TODO: Replace with Polymarket position service or subgraph reconciliation for production PnL.
  return mockPositions;
}

export function getPnLPlaceholder(positions: Position[]) {
  const unrealized = positions.reduce((sum, position) => sum + position.unrealizedPnl, 0);
  return {
    realized: 0,
    unrealized,
    total: unrealized,
    status: "placeholder",
  };
}
