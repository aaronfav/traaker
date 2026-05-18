export function isRealTradingEnabled() {
  return process.env.ENABLE_REAL_TRADING === "true";
}
