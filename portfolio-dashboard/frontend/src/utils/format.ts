/** Y-axis ticks for dollar equity — avoids $0k for balances under $1k. */
export function formatAxisDollars(value: number): string {
  const a = Math.abs(value);
  if (a >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (a >= 100_000) return `$${(value / 1_000).toFixed(0)}k`;
  if (a >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  if (a >= 100) return `$${Math.round(value)}`;
  return `$${value.toFixed(0)}`;
}

export function formatCurrency(value: number, compact = false): string {
  if (compact && Math.abs(value) >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(2)}M`;
  }
  if (compact && Math.abs(value) >= 1_000) {
    return `$${(value / 1_000).toFixed(1)}K`;
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatPercent(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

export function formatNumber(value: number, decimals = 2): string {
  return value.toFixed(decimals);
}

/**
 * Format a ratio/multiplier metric (e.g. Sharpe, Beta).
 * If the value is non-finite or unreasonably large, returns 'ERR' to signal
 * a data quality problem rather than displaying an overflowing number.
 */
export function formatMetric(value: number, decimals = 3, suffix = ''): string {
  if (!isFinite(value) || Math.abs(value) > 9_999) return 'ERR';
  return `${value.toFixed(decimals)}${suffix}`;
}

export function pnlColor(value: number): string {
  if (value > 0) return 'var(--accent-green)';
  if (value < 0) return 'var(--accent-red)';
  return 'var(--text-secondary)';
}

export function pnlClass(value: number): string {
  if (value > 0) return 'text-gain';
  if (value < 0) return 'text-loss';
  return '';
}
