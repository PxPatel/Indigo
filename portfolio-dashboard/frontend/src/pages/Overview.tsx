import { useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { useMemo } from 'react';
import { api, type PortfolioHistoryPoint } from '../api/client';
import { MetricCard } from '../components/MetricCard';
import { Card } from '../components/Card';
import { ChartTooltip } from '../components/ChartTooltip';
import { LoadingShimmer } from '../components/LoadingShimmer';
import { AttributionCard } from '../components/AttributionCard';
import { TimeRangeControl } from '../components/TimeRangeControl';
import { LiveRefreshQuotesToggle } from '../components/LiveRefreshQuotesToggle';
import { createPnlPeriodLineShape } from '../components/PnlPeriodLineShape';
import { formatCurrency, formatPercent, pnlColor, formatAxisDollars } from '../utils/format';
import { format, parseISO } from 'date-fns';
import { useLivePrices, LIVE_SPOT_POLL_MS } from '../hooks/useLivePrices';
import { usePortfolioStore } from '../stores/portfolioStore';
import { getTimeRangeBounds } from '../utils/timeRange';

const COLORS = [
  '#8b5cf6', '#3b82f6', '#06b6d4', '#00dc82', '#f59e0b',
  '#ff4757', '#ec4899', '#6366f1', '#14b8a6', '#f97316',
];

function truncateSymbol(symbol: string, maxChars: number): string {
  if (symbol.length <= maxChars) return symbol;
  return `${symbol.slice(0, Math.max(0, maxChars - 1))}…`;
}

/** Total trading P&L (unrealized + cumulative realized); not equity MTM change. */
function equityTotalPnl(point: PortfolioHistoryPoint): number {
  if (typeof point.equity_total_pnl === 'number' && !Number.isNaN(point.equity_total_pnl)) {
    return point.equity_total_pnl;
  }
  return point.equity_unrealized_pnl;
}

export default function Overview() {
  const timeRangePreset = usePortfolioStore((s) => s.timeRangePreset);
  const customDays = usePortfolioStore((s) => s.customDays);
  const { from: rangeFrom, to: rangeTo } = useMemo(
    () => getTimeRangeBounds(timeRangePreset, customDays),
    [timeRangePreset, customDays],
  );
  const [livePrices, setLivePrices] = useLivePrices();

  const { data: summary, isLoading: loadingSummary } = useQuery({
    queryKey: ['summary', livePrices],
    queryFn: () => api.summary(livePrices),
    staleTime: livePrices ? LIVE_SPOT_POLL_MS : undefined,
  });

  const { data: history, isLoading: loadingHistory } = useQuery({
    queryKey: ['history', rangeFrom, rangeTo],
    queryFn: () => api.history(rangeFrom, rangeTo),
  });

  const { data: benchmark, isLoading: loadingBenchmark } = useQuery({
    queryKey: ['benchmark-overlay', rangeFrom, rangeTo],
    queryFn: () => api.benchmark('SPY', rangeFrom, rangeTo),
  });

  const { data: holdings } = useQuery({
    queryKey: ['holdings', livePrices],
    queryFn: () => api.holdings(livePrices),
    staleTime: livePrices ? LIVE_SPOT_POLL_MS : undefined,
  });

  const { data: txns } = useQuery({
    queryKey: ['transactions-recent', rangeFrom, rangeTo],
    queryFn: () => api.transactions({ from: rangeFrom, to: rangeTo }),
  });

  const { data: rangeRisk, isLoading: loadingRangeRisk } = useQuery({
    queryKey: ['risk-metrics', rangeFrom, rangeTo],
    queryFn: () => api.riskMetrics(rangeFrom, rangeTo),
  });

  const hasHistoryCash = useMemo(
    () => !!history?.history?.some((p) => p.cash_balance != null),
    [history],
  );

  // Merge portfolio history with benchmark for chart (stacked: basis → unrealized gain → cash).
  // Stacked areas must be non-negative: raw unrealized can be negative, so we split as
  // basisStack = min(basis, MTM), unrealizedGainStack = max(0, MTM − basis) (sums to equity MTM).
  const chartData = useMemo(() => {
    if (!history?.history) return [];
    const benchMap = new Map(
      benchmark?.series.map((b) => [b.date, b.benchmark_indexed]) ?? []
    );
    const firstValue = history.history[0]?.value || 1;
    return history.history.map((h) => {
      const basis = h.equity_cost_basis ?? 0;
      const v = h.value;
      const unrealized =
        h.equity_unrealized_pnl ?? v - basis;
      let basisStack: number;
      let unrealizedGainStack: number;
      if (v >= 0) {
        basisStack = Math.min(basis, v);
        unrealizedGainStack = Math.max(0, v - basis);
      } else {
        // Signed equity MTM (net short): one band below zero
        basisStack = 0;
        unrealizedGainStack = v;
      }
      return {
        date: h.date,
        portfolio: v,
        basis,
        unrealized,
        basisStack,
        unrealizedGainStack,
        cashStack: h.cash_balance ?? 0,
        portfolioIndexed: (v / firstValue) * 100,
        benchmark: benchMap.get(h.date),
        return: h.daily_return,
        netWealth: h.net_account_value ?? h.value,
      };
    });
  }, [history, benchmark]);

  const portfolioChartUsesSignOffset = useMemo(
    () => chartData.some((d) => d.portfolio < 0),
    [chartData],
  );

  const chartPointCount = chartData.length;
  const xTickFormatter = useMemo(() => {
    if (chartPointCount < 2) {
      return (v: string) => format(parseISO(v), 'MMM d');
    }
    const first = parseISO(chartData[0]!.date);
    const last = parseISO(chartData[chartPointCount - 1]!.date);
    const spanDays = (last.getTime() - first.getTime()) / 86400000;
    const crossYear = first.getFullYear() !== last.getFullYear();
    if (spanDays > 400 || crossYear) {
      return (v: string) => format(parseISO(v), 'MMM yyyy');
    }
    if (spanDays > 120) {
      return (v: string) => format(parseISO(v), 'MMM yy');
    }
    return (v: string) => format(parseISO(v), 'MMM d');
  }, [chartData, chartPointCount]);

  // Donut data
  const donutData = useMemo(() => {
    if (!holdings?.holdings) return [];
    return holdings.holdings.map((h) => ({
      name: h.symbol,
      value: h.market_value,
      weight: h.weight,
    }));
  }, [holdings]);

  // Period trading P&L dollars = Δ(unrealized + cumulative realized); excludes cash / fund transfers.
  const periodTradingPnlMetrics = useMemo(() => {
    const h = history?.history;
    if (!h?.length) return null;
    const t0 = equityTotalPnl(h[0]);
    const tLast = equityTotalPnl(h[h.length - 1]);
    if (h.length < 2) {
      return { pnlDollars: 0 };
    }
    return { pnlDollars: tLast - t0 };
  }, [history]);

  /** Same as Benchmark page: compound return from daily returns (TWR-style index end/start − 1), % */
  const periodPortfolioTwrPercent = useMemo(() => {
    if (benchmark?.series && benchmark.series.length >= 2 && benchmark.stats) {
      return benchmark.stats.portfolio_total_return;
    }
    const h = history?.history;
    if (h && h.length >= 2) {
      return h[h.length - 1].cumulative_return;
    }
    return null;
  }, [benchmark, history]);

  const pnlCurveData = useMemo(() => {
    const h = history?.history;
    if (!h?.length) return [];
    const t0 = equityTotalPnl(h[0]);
    return h.map((point) => ({
      date: point.date,
      cumulativePnl: equityTotalPnl(point) - t0,
    }));
  }, [history]);

  const pnlLineShape = useMemo(
    () => createPnlPeriodLineShape(pnlCurveData),
    [pnlCurveData],
  );

  if (loadingSummary) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            rowGap: 12,
          }}
        >
          <TimeRangeControl />
          <LiveRefreshQuotesToggle checked={livePrices} onChange={setLivePrices} />
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          {[...Array(6)].map((_, i) => <LoadingShimmer key={i} height={80} />)}
        </div>
        <LoadingShimmer height={350} />
      </div>
    );
  }

  const s = summary!;
  const recentTxns = txns?.transactions.slice(-10).reverse() ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          rowGap: 12,
        }}
      >
        <TimeRangeControl />
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 14,
            marginLeft: 'auto',
          }}
        >
          <LiveRefreshQuotesToggle checked={livePrices} onChange={setLivePrices} />
          {s.current_prices_cached_at != null && (
            <span
              style={{
                fontSize: 11,
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-muted)',
                lineHeight: 1.4,
                maxWidth: 420,
                textAlign: 'right',
              }}
            >
              Oldest spot quote: {format(new Date(s.current_prices_cached_at), 'PPpp')} · max age{' '}
              {s.current_price_ttl_seconds}s
            </span>
          )}
        </div>
      </div>
      {/* Metric cards */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <MetricCard
          index={0}
          label="Net Account Value"
          value={s.net_account_value != null ? formatCurrency(s.net_account_value) : 'N/A'}
          tooltip="Holdings market value + estimated cash balance. A proxy for total account value."
        />
        <MetricCard
          index={1}
          label="Market Value"
          value={formatCurrency(s.total_value)}
          tooltip="Total market value of all open positions right now."
        />
        <MetricCard
          index={2}
          label="Cash Balance"
          value={s.cash_balance != null ? formatCurrency(s.cash_balance) : 'N/A'}
          tooltip="Estimated cash balance derived from a known anchor date, walked forward and backward through all trades and transfers."
        />
        <MetricCard
          index={3}
          label="Total P&L"
          value={
            loadingHistory
              ? '—'
              : periodTradingPnlMetrics != null
                ? formatCurrency(periodTradingPnlMetrics.pnlDollars)
                : formatCurrency(s.total_pnl_dollars)
          }
          subtitle={
            loadingHistory
              ? undefined
              : periodTradingPnlMetrics != null
                ? loadingBenchmark || periodPortfolioTwrPercent == null
                  ? '—'
                  : formatPercent(periodPortfolioTwrPercent)
                : formatPercent(s.total_pnl_percent)
          }
          colorValue={
            loadingHistory
              ? undefined
              : periodTradingPnlMetrics != null
                ? periodTradingPnlMetrics.pnlDollars
                : s.total_pnl_dollars
          }
          tooltip={
            periodTradingPnlMetrics != null && !loadingHistory
              ? 'Dollar change is trading P&L (unrealized + cumulative realized) from first to last day in the range. Subtitle % is portfolio time-weighted total return for the same range (same method as Benchmark vs SPY: compounded daily returns, with fund-transfer days adjusted).'
              : 'Combined unrealized P&L (open positions vs. cost basis) plus realized P&L from all closed trades (full history).'
          }
        />
        <MetricCard
          index={4}
          label="Today"
          value={formatCurrency(s.today_change_dollars)}
          subtitle={formatPercent(s.today_change_percent)}
          colorValue={s.today_change_dollars}
          tooltip="Change in market value of open positions since yesterday's close."
        />
        <MetricCard
          index={5}
          label="Sharpe Ratio"
          value={loadingRangeRisk || !rangeRisk ? '—' : rangeRisk.sharpe_ratio.toFixed(3)}
          tooltip="(Annualized return − 5% risk-free rate) ÷ annualized volatility over the selected time range. Above 1.0 is good; above 2.0 is excellent."
        />
        <MetricCard
          index={6}
          label="Beta vs SPY"
          value={loadingRangeRisk || !rangeRisk ? '—' : rangeRisk.beta.toFixed(3)}
          tooltip="Covariance of your daily returns with SPY ÷ variance of SPY over the selected time range. 1.0 ≈ moving with the S&P 500."
        />
      </div>

      {/* Chart + Donut row */}
      <div style={{ display: 'flex', gap: 16 }}>
        {/* Portfolio value chart */}
        <Card title="Portfolio Value" style={{ flex: 3 }} index={1}>
          {loadingHistory ? (
            <LoadingShimmer height={280} />
          ) : chartPointCount === 0 ? (
            <div
              style={{
                height: 280,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-muted)',
                fontSize: 13,
              }}
            >
              No history in this range
            </div>
          ) : (
            <>
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart
                data={chartData}
                margin={{ top: 6, right: 8, left: 0, bottom: 4 }}
                stackOffset={portfolioChartUsesSignOffset ? 'sign' : undefined}
              >
                <defs>
                  <linearGradient id="basisGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--accent-purple)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--accent-purple)" stopOpacity={0.08} />
                  </linearGradient>
                  <linearGradient id="unrealGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#64748b" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="#64748b" stopOpacity={0.12} />
                  </linearGradient>
                  <linearGradient id="cashGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#06b6d4" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#06b6d4" stopOpacity={0.1} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--border)' }}
                  tickFormatter={xTickFormatter}
                  minTickGap={chartPointCount <= 14 ? 4 : chartPointCount <= 45 ? 20 : 50}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 10, fill: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={formatAxisDollars}
                  width={58}
                />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const row = payload[0]?.payload as {
                      basis: number;
                      unrealized: number;
                      cashStack: number;
                      portfolio: number;
                      netWealth: number;
                    };
                    const u = row.unrealized;
                    return (
                      <div
                        style={{
                          background: 'var(--bg-tertiary)',
                          border: '1px solid var(--border-active)',
                          borderRadius: 4,
                          padding: '8px 12px',
                          fontSize: 12,
                          fontFamily: 'var(--font-mono)',
                        }}
                      >
                        <div style={{ color: 'var(--text-secondary)', marginBottom: 6, fontSize: 11 }}>
                          {label}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                          <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--accent-purple)', opacity: 0.7 }} />
                          <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>Cost basis:</span>
                          <span style={{ color: 'var(--text-primary)' }}>{formatCurrency(row.basis)}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                          <span style={{ width: 8, height: 8, borderRadius: 2, background: '#64748b' }} />
                          <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>{'Unrealized P&L:'}</span>
                          <span style={{ color: pnlColor(u) }}>{formatCurrency(u)}</span>
                        </div>
                        {hasHistoryCash && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                            <span style={{ width: 8, height: 8, borderRadius: 2, background: '#06b6d4' }} />
                            <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>Cash:</span>
                            <span style={{ color: 'var(--text-primary)' }}>{formatCurrency(row.cashStack)}</span>
                          </div>
                        )}
                        <div
                          style={{
                            marginTop: 8,
                            paddingTop: 6,
                            borderTop: '1px solid var(--border)',
                            display: 'flex',
                            justifyContent: 'space-between',
                            gap: 12,
                          }}
                        >
                          <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>Equity MTM</span>
                          <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{formatCurrency(row.portfolio)}</span>
                        </div>
                        {hasHistoryCash && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 4 }}>
                            <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>Net account</span>
                            <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{formatCurrency(row.netWealth)}</span>
                          </div>
                        )}
                      </div>
                    );
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="basisStack"
                  stackId="nav"
                  stroke="var(--accent-purple)"
                  strokeWidth={1.5}
                  fill="url(#basisGrad)"
                  name="Cost basis"
                  connectNulls
                >
                  {chartData.map((entry, index) => (
                    <Cell
                      key={`basis-${entry.date}-${index}`}
                      fill={
                        entry.unrealized < 0 && entry.portfolio >= 0
                          ? 'rgba(255, 71, 87, 0.22)'
                          : 'url(#basisGrad)'
                      }
                      stroke={
                        entry.unrealized < 0 && entry.portfolio >= 0
                          ? 'rgba(255, 71, 87, 0.55)'
                          : 'var(--accent-purple)'
                      }
                    />
                  ))}
                </Area>
                <Area
                  type="monotone"
                  dataKey="unrealizedGainStack"
                  stackId="nav"
                  stroke="#64748b"
                  strokeWidth={1.5}
                  fill="url(#unrealGrad)"
                  name={'Unrealized P&L'}
                  connectNulls
                />
                {hasHistoryCash && (
                  <Area
                    type="monotone"
                    dataKey="cashStack"
                    stackId="nav"
                    stroke="#06b6d4"
                    strokeWidth={1.5}
                    fill="url(#cashGrad)"
                    name="Cash"
                    connectNulls
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
            <div
              style={{
                display: 'flex',
                gap: 16,
                marginTop: 10,
                flexWrap: 'wrap',
                fontSize: 11,
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-muted)',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--accent-purple)', opacity: 0.7 }} />
                Cost basis
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: '#64748b' }} />
                {'Unrealized P&L'}
              </span>
              {hasHistoryCash && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: '#06b6d4' }} />
                  Cash
                </span>
              )}
            </div>
            </>
          )}
        </Card>

        {/* Allocation donut */}
        <Card title="Allocation" style={{ flex: 1.2, minWidth: 260 }} index={2}>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={donutData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={55}
                outerRadius={80}
                strokeWidth={0}
              >
                {donutData.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload;
                  return (
                    <div style={{
                      background: 'var(--bg-tertiary)',
                      border: '1px solid var(--border-active)',
                      borderRadius: 4,
                      padding: '6px 10px',
                      fontSize: 12,
                      fontFamily: 'var(--font-mono)',
                    }}>
                      <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{d.name}</div>
                      <div style={{ color: 'var(--text-secondary)' }}>
                        {formatCurrency(d.value)} ({d.weight.toFixed(1)}%)
                      </div>
                    </div>
                  );
                }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)' }}>
            {donutData.slice(0, 8).map((d, i) => (
              <div key={d.name} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '3px 0',
              }}>
                <span style={{
                  width: 8,
                  height: 8,
                  borderRadius: 2,
                  background: COLORS[i % COLORS.length],
                  flexShrink: 0,
                }} />
                <span style={{ color: 'var(--text-secondary)', flex: 1, fontSize: 11 }}>{d.name}</span>
                <span style={{ color: 'var(--text-primary)', fontSize: 11 }}>{d.weight.toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Period cumulative P&L (from range start = 0) */}
      <Card
        title="Period P&L"
        titleInfo="Cumulative change in trading P&L (unrealized + realized) versus the first day in the range, matching Total P&L when a range is selected. Cash and fund transfers do not affect this curve. Green segments are where the curve is above zero; red where below."
        index={7}
      >
        {loadingHistory ? (
          <LoadingShimmer height={220} />
        ) : pnlCurveData.length === 0 ? (
          <div
            style={{
              height: 220,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-muted)',
              fontSize: 13,
            }}
          >
            No history in this range
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={pnlCurveData} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                tickLine={false}
                axisLine={{ stroke: 'var(--border)' }}
                tickFormatter={xTickFormatter}
                minTickGap={pnlCurveData.length <= 14 ? 4 : pnlCurveData.length <= 45 ? 20 : 50}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 10, fill: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
                tickLine={false}
                axisLine={false}
                tickFormatter={formatAxisDollars}
                width={58}
              />
              <Tooltip content={<ChartTooltip />} />
              <ReferenceLine y={0} stroke="var(--text-muted)" strokeDasharray="4 4" strokeOpacity={0.6} />
              <Line
                type="linear"
                dataKey="cumulativePnl"
                name="Period P&L"
                dot={false}
                stroke="none"
                strokeWidth={0}
                isAnimationActive={false}
                shape={pnlLineShape as never}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* Bottom row — recent txns need width; top movers is compact */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        {/* Recent transactions */}
        <Card title="Recent Transactions" style={{ flex: '2.25 1 280px', minWidth: 0 }} index={8}>
          <table
            style={{
              width: '100%',
              tableLayout: 'fixed',
              borderCollapse: 'collapse',
              fontSize: 12,
            }}
          >
            <colgroup>
              <col style={{ width: 72 }} />
              <col />
              <col style={{ width: 56 }} />
              <col style={{ width: 56 }} />
              <col style={{ width: 64 }} />
              <col style={{ width: 88 }} />
            </colgroup>
            <thead>
              <tr style={{ color: 'var(--text-muted)', textAlign: 'left', fontSize: 10 }}>
                <th style={{ padding: '4px 8px' }}>Date</th>
                <th style={{ padding: '4px 8px' }}>Symbol</th>
                <th style={{ padding: '4px 8px' }}>Side</th>
                <th style={{ padding: '4px 8px', textAlign: 'right' }}>Qty</th>
                <th style={{ padding: '4px 8px', textAlign: 'right' }}>Price</th>
                <th style={{ padding: '4px 8px', textAlign: 'right' }}>Amt</th>
              </tr>
            </thead>
            <tbody>
              {recentTxns.map((t, i) => (
                <tr
                  key={i}
                  style={{
                    background: i % 2 === 0 ? 'var(--bg-secondary)' : 'var(--bg-tertiary)',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  <td
                    style={{
                      padding: '6px 8px',
                      color: 'var(--text-secondary)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {t.date.slice(5)}
                  </td>
                  <td style={{ padding: '6px 8px', fontWeight: 600, maxWidth: 0 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        minWidth: 0,
                      }}
                    >
                      <span
                        title={t.symbol}
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          minWidth: 0,
                          flex: 1,
                        }}
                      >
                        {truncateSymbol(t.symbol, 22)}
                      </span>
                      {t.instrument_type === 'option' && (
                        <span
                          style={{
                            flexShrink: 0,
                            fontSize: 8,
                            fontWeight: 700,
                            padding: '1px 3px',
                            borderRadius: 2,
                            background: 'rgba(139,92,246,0.25)',
                            color: 'var(--accent-purple)',
                            letterSpacing: '0.3px',
                          }}
                        >
                          OPT
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    <span style={{
                      padding: '1px 6px',
                      borderRadius: 3,
                      fontSize: 10,
                      fontWeight: 600,
                      background: t.side === 'BUY' ? 'rgba(0,220,130,0.15)' : 'rgba(255,71,87,0.15)',
                      color: t.side === 'BUY' ? 'var(--accent-green)' : 'var(--accent-red)',
                    }}>
                      {t.side}
                    </span>
                  </td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>{t.quantity}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    ${t.price.toFixed(2)}
                  </td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {formatCurrency(t.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        {/* Attribution */}
        <AttributionCard index={9} style={{ flex: '1 1 350px', minWidth: 0 }} />

        {/* Top Movers */}
        <Card title="Top Movers" style={{ flex: '0.75 1 200px', minWidth: 0, maxWidth: 320 }} index={10}>
          {holdings?.holdings
            .filter((h) => h.today_change_percent !== 0)
            .sort((a, b) => Math.abs(b.today_change_percent) - Math.abs(a.today_change_percent))
            .slice(0, 8)
            .map((h) => (
              <div
                key={h.symbol}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '6px 0',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <div>
                  <span style={{
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 600,
                    fontSize: 13,
                  }}>
                    {h.symbol}
                  </span>
                  <span style={{
                    color: 'var(--text-muted)',
                    fontSize: 11,
                    marginLeft: 8,
                  }}>
                    {h.name.length > 20 ? h.name.slice(0, 20) + '...' : h.name}
                  </span>
                </div>
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 600,
                  fontSize: 13,
                  color: pnlColor(h.today_change_percent),
                }}>
                  {formatPercent(h.today_change_percent)}
                </span>
              </div>
            )) ?? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: 20, textAlign: 'center' }}>
              No data yet
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
