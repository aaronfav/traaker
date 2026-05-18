export type ScoreInput = {
  liquidity: number;
  volume: number;
  priceMove24h: number;
  recentTrades: number;
  spread?: number;
  volumeAcceleration?: number;
};

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const scaleLog = (value: number, pivot: number) => clamp((Math.log10(Math.max(value, 0) + 1) / Math.log10(pivot + 1)) * 100);

export function liquidityScore(liquidity: number) {
  return Math.round(scaleLog(liquidity, 250_000));
}

export function spreadScore(spread: number) {
  if (!Number.isFinite(spread) || spread < 0) return 0;
  return Math.round(clamp(100 - spread * 1_000));
}

export function momentumScore(priceMove24h: number, recentTrades: number) {
  const movement = clamp(Math.abs(priceMove24h) * 650);
  const activity = scaleLog(recentTrades, 250);
  return Math.round(clamp(movement * 0.65 + activity * 0.35));
}

export function volatilityScore(priceMove24h: number) {
  return Math.round(clamp(Math.abs(priceMove24h) * 1_000));
}

export function opportunityScore(input: ScoreInput) {
  const liquidity = liquidityScore(input.liquidity);
  const volume = scaleLog(input.volume, 1_000_000);
  const movement = clamp(Math.abs(input.priceMove24h) * 700);
  const activity = scaleLog(input.recentTrades, 350);
  const spread = input.spread === undefined ? 65 : spreadScore(input.spread);
  const acceleration = clamp((input.volumeAcceleration ?? 1) * 35);

  return Math.round(
    liquidity * 0.24 + volume * 0.22 + movement * 0.16 + activity * 0.14 + spread * 0.14 + acceleration * 0.1,
  );
}

export function volumeAcceleration(volume24h: number, volume1wk: number) {
  const dailyBaseline = volume1wk > 0 ? volume1wk / 7 : 0;
  if (dailyBaseline <= 0) return volume24h > 0 ? 2 : 0;
  return volume24h / dailyBaseline;
}

export function opportunityExplanation(input: ScoreInput) {
  return [
    `Liquidity ${liquidityScore(input.liquidity)}/100`,
    `Volume ${Math.round(scaleLog(input.volume, 1_000_000))}/100`,
    `Momentum ${momentumScore(input.priceMove24h, input.recentTrades)}/100`,
    `Spread ${spreadScore(input.spread ?? 0.04)}/100`,
  ].join(" · ");
}

export function volumeSpikeIndicator(volume24h: number, baselineVolume: number) {
  if (baselineVolume <= 0) return volume24h > 0 ? "New flow" : "Quiet";
  const ratio = volume24h / baselineVolume;
  if (ratio >= 2.5) return "Extreme";
  if (ratio >= 1.5) return "Elevated";
  if (ratio >= 0.8) return "Normal";
  return "Cooling";
}
