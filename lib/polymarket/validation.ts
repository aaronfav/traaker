import { z } from "zod";

export const orderSideSchema = z.enum(["BUY", "SELL"]);
export const orderTypeSchema = z.enum(["limit", "market"]);

export const tradeValidationSchema = z.object({
  walletConnected: z.boolean(),
  chainId: z.number().int(),
  tokenID: z.string().regex(/^\d+$/, "Market token id is missing or invalid."),
  amount: z.number().positive("Amount must be greater than 0.").max(25_000, "Amount exceeds the single order safety limit."),
  price: z.number().gt(0, "Price must be greater than 0.").lt(1, "Price must be less than 1."),
  slippageBps: z.number().int().min(0).max(1_000, "Slippage cannot exceed 10%."),
  availableBalance: z.number().min(0),
  builderCode: z.string().regex(/^0x[a-fA-F0-9]{64}$/, "Builder code must be a bytes32 hex string."),
});

export type TradeValidationInput = z.input<typeof tradeValidationSchema>;

export function validateTrade(input: TradeValidationInput) {
  const result = tradeValidationSchema.safeParse(input);
  const errors: string[] = [];

  if (!result.success) {
    errors.push(...result.error.issues.map((issue) => issue.message));
  } else if (!result.data.walletConnected) {
    errors.push("Connect a wallet before trading.");
  } else if (result.data.chainId !== 137) {
    errors.push("Switch to Polygon mainnet before trading.");
  } else if (result.data.amount > result.data.availableBalance) {
    errors.push("Insufficient USDC/pUSD balance for this order.");
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}
