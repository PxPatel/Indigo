import type { HoldingsResponse, PriceRefreshMode } from '../api/client';

export const HOLDINGS_LAST_SEEN_KEY = 'indigo-holdings-last-seen-v1';

export interface LastSeenHolding {
  symbol: string;
  instrument_type: 'stock' | 'option';
  shares: number;
  current_price: number;
  market_value: number;
  cost_basis: number;
  pnl_dollars: number;
  today_change_dollars: number;
  weight: number;
}

export interface HoldingsLastSeenSnapshot {
  version: 1;
  savedAt: string;
  portfolioKey: string;
  priceMode: PriceRefreshMode;
  holdings: LastSeenHolding[];
  totals: {
    total_market_value: number;
    total_pnl_dollars: number;
    today_change_dollars: number;
  };
}

export interface LastSeenHoldingDiff {
  symbol: string;
  status: 'unchanged' | 'new' | 'closed' | 'shares_changed';
  previous: LastSeenHolding | null;
  current: LastSeenHolding | null;
  deltas: {
    shares: number;
    price: number;
    market_value: number;
    pnl_dollars: number;
    today_change_dollars: number;
    weight: number;
  };
}

export interface HoldingsLastSeenDiff {
  previousSavedAt: string;
  currentSavedAt: string;
  totals: {
    market_value: number;
    pnl_dollars: number;
    today_change_dollars: number;
  };
  rows: LastSeenHoldingDiff[];
  biggestMovers: LastSeenHoldingDiff[];
  positionChanges: LastSeenHoldingDiff[];
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function holdingKeyPart(h: LastSeenHolding): string {
  return [
    h.symbol,
    h.instrument_type,
    round4(h.shares),
    round2(h.cost_basis),
  ].join(':');
}

export function buildPortfolioKey(holdings: LastSeenHolding[]): string {
  return holdings
    .map(holdingKeyPart)
    .sort()
    .join('|');
}

export function buildHoldingsSnapshot(
  data: HoldingsResponse,
  priceMode: PriceRefreshMode,
  savedAt = new Date().toISOString(),
  portfolioSymbols?: string[],
): HoldingsLastSeenSnapshot | null {
  if (!data.holdings.length) return null;

  const holdings = data.holdings.map((h) => ({
    symbol: h.symbol,
    instrument_type: h.instrument_type,
    shares: h.shares,
    current_price: h.current_price,
    market_value: h.market_value,
    cost_basis: h.cost_basis,
    pnl_dollars: h.pnl_dollars,
    today_change_dollars: h.today_change_dollars,
    weight: h.weight,
  }));

  return {
    version: 1,
    savedAt,
    portfolioKey: portfolioSymbols?.length
      ? portfolioSymbols.map((s) => s.toUpperCase()).sort().join('|')
      : buildPortfolioKey(holdings),
    priceMode,
    holdings,
    totals: {
      total_market_value: data.total_market_value,
      total_pnl_dollars: data.total_pnl_dollars,
      today_change_dollars: round2(
        data.holdings.reduce((sum, h) => sum + h.today_change_dollars, 0),
      ),
    },
  };
}

export function loadHoldingsSnapshot(portfolioKey: string): HoldingsLastSeenSnapshot | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(HOLDINGS_LAST_SEEN_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as HoldingsLastSeenSnapshot;
    if (parsed.version !== 1 || parsed.portfolioKey !== portfolioKey) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveHoldingsSnapshot(snapshot: HoldingsLastSeenSnapshot): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(HOLDINGS_LAST_SEEN_KEY, JSON.stringify(snapshot));
}

function bySymbol(snapshot: HoldingsLastSeenSnapshot): Map<string, LastSeenHolding> {
  return new Map(snapshot.holdings.map((h) => [h.symbol, h]));
}

export function diffHoldingsSnapshot(
  previous: HoldingsLastSeenSnapshot,
  current: HoldingsLastSeenSnapshot,
): HoldingsLastSeenDiff {
  const prevMap = bySymbol(previous);
  const currMap = bySymbol(current);
  const symbols = Array.from(new Set([...prevMap.keys(), ...currMap.keys()])).sort();

  const rows = symbols.map((symbol): LastSeenHoldingDiff => {
    const prev = prevMap.get(symbol) ?? null;
    const curr = currMap.get(symbol) ?? null;
    const status =
      prev === null
        ? 'new'
        : curr === null
          ? 'closed'
          : Math.abs(curr.shares - prev.shares) > 0.0001
            ? 'shares_changed'
            : 'unchanged';

    return {
      symbol,
      status,
      previous: prev,
      current: curr,
      deltas: {
        shares: round4((curr?.shares ?? 0) - (prev?.shares ?? 0)),
        price: round2((curr?.current_price ?? 0) - (prev?.current_price ?? 0)),
        market_value: round2((curr?.market_value ?? 0) - (prev?.market_value ?? 0)),
        pnl_dollars: round2((curr?.pnl_dollars ?? 0) - (prev?.pnl_dollars ?? 0)),
        today_change_dollars: round2(
          (curr?.today_change_dollars ?? 0) - (prev?.today_change_dollars ?? 0),
        ),
        weight: round2((curr?.weight ?? 0) - (prev?.weight ?? 0)),
      },
    };
  });

  return {
    previousSavedAt: previous.savedAt,
    currentSavedAt: current.savedAt,
    totals: {
      market_value: round2(current.totals.total_market_value - previous.totals.total_market_value),
      pnl_dollars: round2(current.totals.total_pnl_dollars - previous.totals.total_pnl_dollars),
      today_change_dollars: round2(
        current.totals.today_change_dollars - previous.totals.today_change_dollars,
      ),
    },
    rows,
    biggestMovers: [...rows]
      .sort((a, b) => Math.abs(b.deltas.pnl_dollars) - Math.abs(a.deltas.pnl_dollars))
      .slice(0, 6),
    positionChanges: rows.filter((row) => row.status !== 'unchanged'),
  };
}
