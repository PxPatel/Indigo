/** Price axis padding and tick step per cost-basis ladder spec. */

export function padPriceDomain(
  lotPrices: number[],
  currentPrice: number,
): { min: number; max: number } {
  if (lotPrices.length === 0) {
    const p = Math.abs(currentPrice) || 1;
    return { min: currentPrice - p * 0.05, max: currentPrice + p * 0.05 };
  }
  let lo = Math.min(...lotPrices, currentPrice);
  let hi = Math.max(...lotPrices, currentPrice);
  const span = hi - lo || Math.abs(hi) * 0.05 || 1;
  const pad = span * 0.05;
  return { min: lo - pad, max: hi + pad };
}

export function pickPriceTickStep(spread: number): number {
  const s = Math.abs(spread);
  if (s < 20) return 2;
  if (s < 100) return s / 5 <= 10 ? 5 : 10;
  if (s < 500) return s / 25 <= 10 ? 25 : 50;
  return s / 50 <= 10 ? 50 : 100;
}
