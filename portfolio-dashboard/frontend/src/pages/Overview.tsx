import { useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { useState, useMemo } from 'react';
import { api } from '../api/client';
import { MetricCard } from '../components/MetricCard';
import { Card } from '../components/Card';
import { ChartTooltip } from '../components/ChartTooltip';
import { LoadingShimmer } from '../components/LoadingShimmer';
import { AttributionCard } from '../components/AttributionCard';
import { formatCurrency, formatPercent, pnlColor, formatAxisDollars } from '../utils/format';
import { subDays, subMonths, subYears, startOfYear, format, parseISO } from 'date-fns';
import { useLivePrices, LIVE_SPOT_POLL_MS } from '../hooks/useLivePrices';

const RANGES = ['1W', '1M', '3M', '6M', 'YTD', '1Y', 'ALL'] as const;
type Range = typeof RANGES[number];

const COLORS = [
  '#8b5cf6', '#3b82f6', '#06b6d4', '#00dc82', '#f59e0b',
  '#ff4757', '#ec4899', '#6366f1', '#14b8a6', '#f97316',
];

function getRangeStart(range: Range): string | undefined {
  const now = new Date();
  switch (range) {
    case '1W': return format(subDays(now, 7), 'yyyy-MM-dd');
    case '1M': return format(subMonths(now, 1), 'yyyy-MM-dd');
    case '3M': return format(subMonths(now, 3), 'yyyy-MM-dd');
    case '6M': return format(subMonths(now, 6), 'yyyy-MM-dd');
    case 'YTD': return format(startOfYear(now), 'yyyy-MM-dd');
    case '1Y': return format(subYears(now, 1), 'yyyy-MM-dd');
    case 'ALL': return undefined;
  }
}

export default function Overview() {
  const [range, setRange] = useState<Range>('ALL');
  const rangeStart = getRangeStart(range);
  const [livePrices, setLivePrices] = useLivePrices();

  const { data: summary, isLoading: loadingSummary } = useQuery({
    queryKey: ['summary', livePrices],
    queryFn: () => api.summary(livePrices),
    staleTime: livePrices ? LIVE_SPOT_POLL_MS : undefined,
  });

  const { data: history, isLoading: loadingHistory } = useQuery({
    queryKey: ['history', rangeStart],
    queryFn: () => api.history(rangeStart),
  });

  const { data: benchmark } = useQuery({
    queryKey: ['benchmark-overlay', rangeStart],
    queryFn: () => api.benchmark('SPY', rangeStart),
  });

  const { data: holdings } = useQuery({
    queryKey: ['holdings', livePrices],
    queryFn: () => api.holdings(livePrices),
    staleTime: livePrices ? LIVE_SPOT_POLL_MS : undefined,
  });

  const { data: txns } = useQuery({
    queryKey: ['transactions-recent'],
    queryFn: () => api.transactions(),
  });


  // Merge portfolio history with benchmark for chart
  const chartData = useMemo(() => {
    if (!history?.history) return [];
    const benchMap = new Map(
      benchmark?.series.map((b) => [b.date, b.benchmark_indexed]) ?? []
    );
    const firstValue = history.history[0]?.value || 1;
    return history.history.map((h) => ({
      date: h.date,
      portfolio: h.value,
      portfolioIndexed: (h.value / firstValue) * 100,
      benchmark: benchMap.get(h.date),
      return: h.daily_return,
    }));
  }, [history, benchmark]);

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

  if (loadingSummary) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
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
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 12,
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            userSelect: 'none',
          }}
        >
          <input
            type="checkbox"
            checked={livePrices}
            onChange={(e) => setLivePrices(e.target.checked)}
            style={{ accentColor: 'var(--accent-green)' }}
          />
          Live spot quotes (faster refresh when on)
        </label>
        {s.current_prices_cached_at != null && (
          <span
            style={{
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-muted)',
            }}
          >
            Oldest spot quote: {format(new Date(s.current_prices_cached_at), 'PPpp')} · max age{' '}
            {s.current_price_ttl_seconds}s
          </span>
        )}
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
          value={formatCurrency(s.total_pnl_dollars)}
          subtitle={formatPercent(s.total_pnl_percent)}
          colorValue={s.total_pnl_dollars}
          tooltip="Combined unrealized P&L (open positions vs. cost basis) plus realized P&L from all closed trades."
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
          value={s.sharpe_ratio.toFixed(3)}
          tooltip="Return per unit of risk: (annualized return − 5% risk-free rate) ÷ annualized volatility. Above 1.0 is good; above 2.0 is excellent."
        />
        <MetricCard
          index={6}
          label="Beta vs SPY"
          value={s.beta.toFixed(3)}
          tooltip="How much your portfolio moves with the market. 1.0 = in lockstep with S&P 500. Above 1 = more volatile. Below 1 = more stable."
        />
      </div>

      {/* Chart + Donut row */}
      <div style={{ display: 'flex', gap: 16 }}>
        {/* Portfolio value chart */}
        <Card title="Portfolio Value" style={{ flex: 3 }} index={1}>
          <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
            {RANGES.map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                style={{
                  padding: '4px 10px',
                  fontSize: 11,
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 500,
                  background: range === r ? 'var(--accent-blue)' : 'var(--bg-tertiary)',
                  color: range === r ? '#fff' : 'var(--text-secondary)',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                {r}
              </button>
            ))}
          </div>
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
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart
                data={chartData}
                margin={{ top: 6, right: 8, left: 0, bottom: 4 }}
              >
                <defs>
                  <linearGradient id="portfolioGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--accent-purple)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="var(--accent-purple)" stopOpacity={0} />
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
                <Tooltip content={<ChartTooltip />} />
                <Area
                  type="monotone"
                  dataKey="portfolio"
                  stroke="var(--accent-purple)"
                  strokeWidth={2}
                  fill="url(#portfolioGrad)"
                  name="Portfolio"
                  connectNulls
                />
              </ComposedChart>
            </ResponsiveContainer>
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

      {/* Bottom row */}
      <div style={{ display: 'flex', gap: 16 }}>
        {/* Recent transactions */}
        <Card title="Recent Transactions" style={{ flex: 1 }} index={3}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ color: 'var(--text-muted)', textAlign: 'left', fontSize: 10 }}>
                <th style={{ padding: '4px 8px' }}>Date</th>
                <th style={{ padding: '4px 8px' }}>Symbol</th>
                <th style={{ padding: '4px 8px' }}>Side</th>
                <th style={{ padding: '4px 8px', textAlign: 'right' }}>Qty</th>
                <th style={{ padding: '4px 8px', textAlign: 'right' }}>Price</th>
                <th style={{ padding: '4px 8px', textAlign: 'right' }}>Amount</th>
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
                  <td style={{ padding: '6px 8px', color: 'var(--text-secondary)' }}>
                    {t.date.slice(5)}
                  </td>
                  <td style={{ padding: '6px 8px', fontWeight: 600 }}>{t.symbol}</td>
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
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>{t.quantity}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>${t.price.toFixed(2)}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>{formatCurrency(t.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        {/* Attribution */}
        <AttributionCard index={4} style={{ flex: 1 }} />

        {/* Top Movers */}
        <Card title="Top Movers" style={{ flex: 1 }} index={5}>
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
