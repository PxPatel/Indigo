const BASE = '/api/v1';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(body.detail || res.statusText);
  }
  return res.json();
}

function dateParams(from?: string, to?: string): string {
  const p = new URLSearchParams();
  if (from) p.set('from', from);
  if (to) p.set('to', to);
  const s = p.toString();
  return s ? `?${s}` : '';
}

function chartQueryParams(from?: string, to?: string, timeframe?: string): string {
  const p = new URLSearchParams();
  if (from) p.set('from', from);
  if (to) p.set('to', to);
  if (timeframe) p.set('timeframe', timeframe);
  const s = p.toString();
  return s ? `?${s}` : '';
}

function liveParam(live: boolean): string {
  const p = new URLSearchParams();
  p.set('live', live ? 'true' : 'false');
  return `?${p.toString()}`;
}

export const api = {
  status: () => request<{ has_data: boolean }>('/status'),
  upload(files: File[]) {
    const form = new FormData();
    for (const file of files) {
      form.append('files', file);
    }
    return request<UploadResponse>('/upload', { method: 'POST', body: form });
  },
  summary: (live = true) =>
    request<PortfolioSummary>(`/portfolio/summary${liveParam(live)}`),
  history: (from?: string, to?: string) =>
    request<PortfolioHistoryResponse>(`/portfolio/history${dateParams(from, to)}`),
  weights: (from?: string, to?: string) =>
    request<PortfolioWeightsResponse>(`/portfolio/weights${dateParams(from, to)}`),
  holdings: (live = true) =>
    request<HoldingsResponse>(`/portfolio/holdings${liveParam(live)}`),
  costBasisLadder: (symbol: string, live = true) =>
    request<CostBasisLadderResponse>(
      `/portfolio/holdings/${encodeURIComponent(symbol)}/cost-ladder${liveParam(live)}`,
    ),
  cashflow: (from?: string, to?: string) =>
    request<CashflowTimelineResponse>(`/cashflow/timeline${dateParams(from, to)}`),
  riskMetrics: () => request<RiskMetricsResponse>('/risk/metrics'),
  drawdown: (from?: string, to?: string) =>
    request<DrawdownResponse>(`/risk/drawdown${dateParams(from, to)}`),
  correlation: () => request<CorrelationResponse>('/risk/correlation'),
  sector: () => request<SectorExposureResponse>('/risk/sector'),
  benchmark: (ticker: string = 'SPY', from?: string, to?: string) => {
    const p = new URLSearchParams({ benchmark: ticker });
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    return request<BenchmarkCompareResponse>(`/benchmark/compare?${p}`);
  },
  transactions: (filters?: { symbol?: string; side?: string; from?: string; to?: string }) => {
    const p = new URLSearchParams();
    if (filters?.symbol) p.set('symbol', filters.symbol);
    if (filters?.side) p.set('side', filters.side);
    if (filters?.from) p.set('from', filters.from);
    if (filters?.to) p.set('to', filters.to);
    const s = p.toString();
    return request<TransactionsResponse>(`/transactions${s ? `?${s}` : ''}`);
  },
  getManualEntries: () => request<ManualEntriesResponse>('/manual-entries'),
  addManualEntry: (entry: ManualEntryRequest) =>
    request<ManualEntriesResponse>('/manual-entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    }),
  deleteManualEntry: (id: number) =>
    request<ManualEntriesResponse>(`/manual-entries/${id}`, { method: 'DELETE' }),
  getFundTransfers: () => request<FundTransfersResponse>('/fund-transfers'),
  addFundTransfer: (transfer: FundTransferRequest) =>
    request<FundTransfersResponse>('/fund-transfers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(transfer),
    }),
  deleteFundTransfer: (id: number) =>
    request<FundTransfersResponse>(`/fund-transfers/${id}`, { method: 'DELETE' }),
  getCashAnchor: () => request<CashAnchorResponse>('/cash-anchor'),
  setCashAnchor: (anchor: CashAnchorRequest) =>
    request<CashAnchorResponse>('/cash-anchor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(anchor),
    }),
  deleteCashAnchor: () =>
    request<CashAnchorResponse>('/cash-anchor', { method: 'DELETE' }),
  attribution: (live = true) =>
    request<AttributionResponse>(`/portfolio/attribution${liveParam(live)}`),
  symbolChart: (symbol: string, from?: string, to?: string, timeframe?: string) =>
    request<SymbolChartResponse>(
      `/symbol/${encodeURIComponent(symbol)}/chart${chartQueryParams(from, to, timeframe)}`,
    ),
  simulator: (benchmark: string = 'SPY') =>
    request<SimulatorResponse>(`/simulator/holdings?benchmark=${encodeURIComponent(benchmark)}`),
};

// Types matching backend schemas
export interface UploadResponse {
  transaction_count: number;
  symbols: string[];
  date_range_start: string;
  date_range_end: string;
  total_invested: number;
}

export interface PortfolioSummary {
  total_value: number;
  total_cost_basis: number;
  total_pnl_dollars: number;
  total_pnl_percent: number;
  today_change_dollars: number;
  today_change_percent: number;
  sharpe_ratio: number;
  max_drawdown: number;
  beta: number;
  holdings_count: number;
  total_invested: number;
  realized_pnl: number;
  unrealized_pnl: number;
  cash_balance: number | null;
  net_account_value: number | null;
  live_prices_enabled: boolean;
  current_price_ttl_seconds: number;
  current_prices_cached_at: string | null;
}

export interface PortfolioHistoryPoint {
  date: string;
  value: number;
  daily_return: number;
  cumulative_return: number;
  /** Equity MTM + implied cash when cash anchor is set */
  net_account_value?: number | null;
}
export interface PortfolioHistoryResponse {
  history: PortfolioHistoryPoint[];
}

export interface WeightPoint {
  date: string;
  weights: Record<string, number>;
}
export interface PortfolioWeightsResponse {
  weights: WeightPoint[];
  symbols: string[];
}

export interface HoldingDetail {
  symbol: string;
  name: string;
  shares: number;
  avg_cost: number;
  current_price: number;
  market_value: number;
  cost_basis: number;
  pnl_dollars: number;
  pnl_percent: number;
  weight: number;
  today_change_percent: number;
  sector: string;
  last_activity: string;
  instrument_type: 'stock' | 'option';
}
export interface HoldingsResponse {
  holdings: HoldingDetail[];
  total_market_value: number;
  total_pnl_dollars: number;
  total_pnl_percent: number;
}

export interface CostBasisMergedLevel {
  price: number;
  shares: number;
  date_start: string;
  date_end: string;
}

export interface FifoLotRow {
  date: string;
  price: number;
  shares: number;
  current_value: number;
  pnl_dollars: number;
  pnl_percent: number;
}

export interface CostBasisLadderResponse {
  symbol: string;
  name: string;
  current_price: number;
  today_change_percent: number;
  today_change_dollars: number;
  unrealized_pnl_dollars: number;
  unrealized_pnl_percent: number;
  avg_days_between_buys: number | null;
  avg_interval_between_lot_prices: number | null;
  open_lot_count: number;
  lots: FifoLotRow[];
  merged_levels: CostBasisMergedLevel[];
  ladder_intro: string;
  footnote: string;
}

export interface CashflowTrade {
  symbol: string;
  side: 'BUY' | 'SELL';
  amount: number;
}

export interface CashflowPoint {
  date: string;
  inflow: number;
  outflow: number;
  net_flow: number;
  cumulative_invested: number;
  cumulative_realized_pnl: number;
  trades: CashflowTrade[];
}
export interface MonthlyCashflow {
  month: string;
  inflow: number;
  outflow: number;
}
export interface SymbolDeployment {
  symbol: string;
  net_deployed: number;
}
export interface CashflowStats {
  total_deployed: number;
  total_withdrawn: number;
  net_invested: number;
  largest_buy: number;
  largest_sell: number;
  avg_transaction_size: number;
}
export interface CashflowTimelineResponse {
  timeline: CashflowPoint[];
  monthly: MonthlyCashflow[];
  by_symbol: SymbolDeployment[];
  stats: CashflowStats;
}

export interface RiskMetricsResponse {
  volatility_annualized: number;
  volatility_30d: number;
  sharpe_ratio: number;
  sortino_ratio: number;
  max_drawdown: number;
  max_drawdown_start: string | null;
  max_drawdown_end: string | null;
  beta: number;
  alpha: number;
  var_95: number;
  hhi: number;
}

export interface DrawdownPoint {
  date: string;
  drawdown: number;
}
export interface DrawdownResponse {
  series: DrawdownPoint[];
  max_drawdown: number;
  max_drawdown_start: string | null;
  max_drawdown_end: string | null;
  rolling_volatility: { date: string; value: number }[];
  rolling_beta: { date: string; value: number }[];
}

export interface CorrelationResponse {
  symbols: string[];
  matrix: number[][];
}

export interface SectorWeight {
  sector: string;
  weight: number;
}
export interface SectorExposureResponse {
  sectors: SectorWeight[];
}

export interface BenchmarkComparePoint {
  date: string;
  portfolio_indexed: number;
  benchmark_indexed: number;
  relative: number;
}
export interface BenchmarkStats {
  portfolio_total_return: number;
  benchmark_total_return: number;
  portfolio_annualized: number;
  benchmark_annualized: number;
  tracking_error: number;
  information_ratio: number;
  up_capture: number;
  down_capture: number;
  correlation: number;
}
export interface BenchmarkCompareResponse {
  series: BenchmarkComparePoint[];
  stats: BenchmarkStats;
  benchmark_ticker: string;
}

export interface TransactionRecord {
  date: string;
  symbol: string;
  side: string;
  type: string;
  quantity: number;
  price: number;
  total: number;
  cumulative_invested: number;
  instrument_type: 'stock' | 'option';
}
export interface TransactionStats {
  total_count: number;
  buy_count: number;
  sell_count: number;
  avg_buy_size: number;
  avg_sell_size: number;
  most_traded_symbol: string;
}
export interface TransactionsResponse {
  transactions: TransactionRecord[];
  stats: TransactionStats;
}

export interface ManualEntryRequest {
  date: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  note: string;
}
export interface ManualEntryRecord {
  id: number;
  date: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  total_amount: number;
  note: string;
}
export interface ManualEntriesResponse {
  entries: ManualEntryRecord[];
  count: number;
}

export interface FundTransferRequest {
  date: string;
  type: 'DEPOSIT' | 'WITHDRAWAL';
  amount: number;
  note: string;
}
export interface FundTransferRecord {
  id: number;
  date: string;
  type: 'DEPOSIT' | 'WITHDRAWAL';
  amount: number;
  note: string;
}
export interface FundTransfersResponse {
  transfers: FundTransferRecord[];
  count: number;
}

export interface CashAnchorRequest {
  date: string;
  balance: number;
}
export interface CashAnchorResponse {
  anchor: CashAnchorRequest | null;
  cash_timeline: { date: string; cash_balance: number }[];
}

export interface OHLCVPoint {
  date: string;
  /** Unix UTC seconds — intraday bars; omit for daily charts */
  time?: number | null;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ClusteredTrade {
  date: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  total_amount: number;
  count: number;
  individual_trades: { date: string; qty: number; price: number; total: number }[];
  unrealized_pnl: number | null;
  realized_pnl: number | null;
}

export interface RoundTrip {
  buy_date: string;
  sell_date: string;
  buy_price: number;
  sell_price: number;
  quantity: number;
  realized_pnl: number;
}

export interface SymbolChartResponse {
  symbol: string;
  ohlcv: OHLCVPoint[];
  trades: ClusteredTrade[];
  round_trips: RoundTrip[];
  current_price: number;
  shares_held: number;
  avg_cost: number;
  has_trade_data: boolean;
}

export interface SimulatorHolding {
  symbol: string;
  instrument_type: 'stock' | 'option';
  market_value: number;
  current_price: number;
  beta_1yr: number | null;
  excluded: boolean;
  exclusion_reason: 'option' | 'no_beta' | null;
}

export interface SimulatorResponse {
  holdings: SimulatorHolding[];
  total_market_value: number;
  benchmark: string;
}

export interface HoldingContribution {
  symbol: string;
  weight: number;       // % of total account (0–100 scale)
  asset_return: number; // day's % return (e.g. +1.5 = +1.5%)
  contribution: number; // percentage-point contribution
}

export interface SectorContribution {
  sector: string;
  contribution: number; // percentage-point contribution
}

export interface AttributionResponse {
  date: string;
  portfolio_return: number;
  contributors: HoldingContribution[];
  cash_weight: number;
  cash_contribution: number;
  top_sector: SectorContribution | null;
  sector_contributions: SectorContribution[];
  is_estimated: boolean;
  data_date: string;
}
