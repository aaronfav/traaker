import { NextResponse } from "next/server";
import { tradeValidationSchema, validateTrade } from "@/lib/polymarket/validation";
import { logError } from "@/lib/server/logger";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = tradeValidationSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, errors: parsed.error.issues.map((issue) => issue.message) }, { status: 400 });
    }

    return NextResponse.json(validateTrade(parsed.data));
  } catch (error) {
    logError("api.polymarket.order.validate", error);
    return NextResponse.json({ ok: false, errors: ["Unable to validate order."] }, { status: 400 });
  }
}
