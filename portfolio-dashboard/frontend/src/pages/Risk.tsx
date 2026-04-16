import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from 'recharts';
import { useMemo } from 'react';
import { api } from '../api/client';
import { MetricCard } from '../components/MetricCard';
import { Card } from '../components/Card';
import { ChartTooltip } from '../components/ChartTooltip';
import { LoadingShimmer } from '../components/LoadingShimmer';
import { TimeRangeControl } from '../components/TimeRangeControl';
import { formatMetric } from '../utils/format';
import { usePortfolioStore } from '../stores/portfolioStore';
import { getTimeRangeBounds } from '../utils/timeRange';

export default function Risk() {
  const setManualEntryModalOpen = usePortfolioStore((s) => s.setManualEntryModalOpen);
  const timeRangePreset = usePortfolioStore((s) => s.timeRangePreset);
  const customDays = usePortfolioStore((s) => s.customDays);
  const { from: rangeFrom, to: rangeTo } = useMemo(
    () => getTimeRangeBounds(timeRangePreset, customDays),
    [timeRangePreset, customDays],
  );

  const { data: metrics, isLoading: loadingMetrics } = useQuery({
    queryKey: ['risk-metrics', rangeFrom, rangeTo],
    queryFn: () => api.riskMetrics(rangeFrom, rangeTo),
  });

  const { data: drawdown, isLoading: loadingDrawdown } = useQuery({
    queryKey: ['drawdown', rangeFrom, rangeTo],
    queryFn: () => api.drawdown(rangeFrom, rangeTo),
  });

  const { data: cashAnchor, isLoading: loadingCashAnchor } = useQuery({
    queryKey: ['cash-anchor'],
    queryFn: api.getCashAnchor,
  });

  const { data: correlation } = useQuery({
    queryKey: ['correlation', rangeFrom, rangeTo],
    queryFn: () => api.correlation(rangeFrom, rangeTo),
  });

  const { data: sector } = useQuery({
    queryKey: ['sector'],
    queryFn: api.sector,
  });

  if (loadingMetrics || loadingDrawdown || loadingCashAnchor) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <TimeRangeControl />
        <LoadingShimmer height={600} />
      </div>
    );
  }
  if (!metrics || !drawdown || !cashAnchor) return null;

  const showEquityOnlyWarning = cashAnchor.anchor === null;

  const rollingVolTitleInfo =
    'Each point is the annualized volatility of your portfolio’s daily returns over the prior 30 trading days: standard deviation × √252. The window needs at least 15 days before a value appears. Higher means recent trading days were choppier. Returns use net account value (equity plus implied cash) when you have a cash balance anchor; otherwise signed equity market value only.';

  const rollingBetaTitleInfo =
    'Each point is rolling beta versus SPY: covariance of your daily returns with SPY’s daily returns, divided by SPY’s variance, over a 60 trading-day window (needs at least 30 days). It estimates how your portfolio tended to move per 1% move in the S&P 500 during that stretch. Daily returns use net account value (equity plus implied cash) when you have a cash balance anchor; otherwise signed equity market value only.';

  // Correlation heatmap color
  const corrColor = (v: number) => {
    if (v > 0.5) return `rgba(255,71,87,${0.3 + v * 0.7})`;
    if (v > 0) return `rgba(255,71,87,${v * 0.5})`;
    if (v < -0.5) return `rgba(59,130,246,${0.3 + Math.abs(v) * 0.7})`;
    if (v < 0) return `rgba(59,130,246,${Math.abs(v) * 0.5})`;
    return 'var(--bg-tertiary)';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <TimeRangeControl />
      {showEquityOnlyWarning && (
        <div
          role="status"
          style={{
            display: 'flex',
            gap: 12,
            alignItems: 'flex-start',
            padding: '12px 14px',
            borderRadius: 8,
            border: '1px solid rgba(245, 158, 11, 0.45)',
            background: 'rgba(245, 158, 11, 0.08)',
            fontSize: 13,
            lineHeight: 1.5,
            color: 'var(--text-primary)',
          }}
        >
          <AlertTriangle
            size={20}
            style={{ flexShrink: 0, marginTop: 2, color: 'var(--accent-amber)' }}
            aria-hidden
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text-primary)' }}>
              No cash balance anchor
            </div>
            <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
              Drawdown, max drawdown, and return-based metrics on this page use{' '}
              <strong style={{ color: 'var(--text-primary)' }}>signed equity market value only</strong>
              — cash is excluded. That can be{' '}
              <strong style={{ color: 'var(--text-primary)' }}>misleading</strong>
              : for example, being fully in cash shows as ~100% drawdown from an earlier equity peak. Set a
              known cash balance anchor (Manual entries → Cash Balance) so metrics align with net account
              value including implied cash.
            </p>
            <button
              type="button"
              onClick={() => setManualEntryModalOpen(true)}
              style={{
                marginTop: 10,
                padding: '6px 12px',
                fontSize: 12,
                fontWeight: 600,
                fontFamily: 'var(--font-body)',
                color: 'var(--accent-amber)',
                background: 'rgba(245, 158, 11, 0.12)',
                border: '1px solid rgba(245, 158, 11, 0.35)',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              Open manual entries
            </button>
          </div>
        </div>
      )}

      {/* Risk metrics */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <MetricCard
          index={0}
          label="Sharpe Ratio"
          value={formatMetric(metrics.sharpe_ratio)}
          tooltip="(Annualized return − 5% risk-free rate) ÷ annualized volatility. Measures return earned per unit of total risk. Above 1.0 is good."
        />
        <MetricCard
          index={1}
          label="Sortino Ratio"
          value={formatMetric(metrics.sortino_ratio)}
          tooltip="Like Sharpe, but only penalizes downside volatility (losing days). Higher than Sharpe means your losses are smaller relative to your gains."
        />
        <MetricCard
          index={2}
          label="Beta"
          value={formatMetric(metrics.beta)}
          tooltip="How much your portfolio moves per 1% move in the S&P 500. Calculated as Cov(portfolio, SPY) ÷ Var(SPY) over the selected time range."
        />
        <MetricCard
          index={3}
          label="Alpha"
          value={formatMetric(metrics.alpha, 2, '%')}
          colorValue={metrics.alpha}
          tooltip="Return above what your market exposure (beta) predicts: portfolio return − (5% + beta × (SPY return − 5%)). Positive = outperforming the market-adjusted expectation."
        />
        <MetricCard
          index={4}
          label="VaR (95%)"
          value={`${metrics.var_95.toFixed(2)}%`}
          colorValue={metrics.var_95}
          tooltip="Historical 5th-percentile daily return. On your worst 5% of trading days, your portfolio lost at least this much."
        />
        <MetricCard
          index={5}
          label="Max Drawdown"
          value={`${metrics.max_drawdown.toFixed(2)}%`}
          colorValue={-1}
          tooltip="Largest peak-to-trough drop in portfolio value. The worst sequence of losses before recovering to a new high."
        />
        <MetricCard
          index={6}
          label="Volatility"
          value={formatMetric(metrics.volatility_annualized, 2, '%')}
          tooltip="Annualized standard deviation of daily returns (daily std × √252). How much your portfolio value swings over a year."
        />
      </div>

      {/* Drawdown chart */}
      <Card title="Drawdown from Peak" index={1}>
        <ResponsiveContainer width="100%" height={250}>
          <AreaChart data={drawdown.series}>
            <defs>
              <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent-red)" stopOpacity={0.4} />
                <stop offset="100%" stopColor="var(--accent-red)" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
              tickLine={false}
              axisLine={{ stroke: 'var(--border)' }}
              tickFormatter={(v) => v.slice(5)}
              minTickGap={50}
            />
            <YAxis
              tick={{ fontSize: 10, fill: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `${v}%`}
              width={50}
            />
            <Tooltip content={<ChartTooltip valueFormat="percent" />} />
            <ReferenceLine
              y={drawdown.max_drawdown}
              stroke="var(--accent-red)"
              strokeDasharray="5 5"
              strokeOpacity={0.6}
            />
            <Area
              type="monotone"
              dataKey="drawdown"
              stroke="var(--accent-red)"
              strokeWidth={1.5}
              fill="url(#ddGrad)"
              name="Drawdown"
            />
          </AreaChart>
        </ResponsiveContainer>
      </Card>

      {/* Rolling charts + correlation */}
      <div style={{ display: 'flex', gap: 16 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Rolling volatility */}
          <Card title="Rolling 30-Day Volatility" titleInfo={rollingVolTitleInfo} index={2}>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={drawdown.rolling_volatility}>
                <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 9, fill: 'var(--text-muted)' }}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--border)' }}
                  tickFormatter={(v) => v.slice(5)}
                  minTickGap={50}
                />
                <YAxis
                  tick={{ fontSize: 9, fill: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `${v}%`}
                  width={45}
                />
                <Tooltip content={<ChartTooltip valueFormat="percent" />} />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="var(--accent-amber)"
                  strokeWidth={1.5}
                  dot={false}
                  name="Volatility"
                />
              </LineChart>
            </ResponsiveContainer>
          </Card>

          {/* Rolling beta */}
          <Card title="Rolling 60-Day Beta" titleInfo={rollingBetaTitleInfo} index={3}>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={drawdown.rolling_beta}>
                <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 9, fill: 'var(--text-muted)' }}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--border)' }}
                  tickFormatter={(v) => v.slice(5)}
                  minTickGap={50}
                />
                <YAxis
                  tick={{ fontSize: 9, fill: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
                  tickLine={false}
                  axisLine={false}
                  width={35}
                />
                <Tooltip content={<ChartTooltip valueFormat="number" />} />
                <ReferenceLine y={1} stroke="var(--text-muted)" strokeDasharray="5 5" />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="var(--accent-cyan)"
                  strokeWidth={1.5}
                  dot={false}
                  name="Beta"
                />
              </LineChart>
            </ResponsiveContainer>
          </Card>
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Correlation heatmap */}
          {correlation && correlation.symbols.length > 1 && (
            <Card title="Correlation Matrix" index={4}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', fontSize: 10, fontFamily: 'var(--font-mono)' }}>
                  <thead>
                    <tr>
                      <th style={{ padding: 4 }} />
                      {correlation.symbols.map((s) => (
                        <th key={s} style={{
                          padding: '4px 6px',
                          color: 'var(--text-secondary)',
                          fontWeight: 500,
                          writingMode: correlation.symbols.length > 6 ? 'vertical-rl' : undefined,
                        }}>
                          {s}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {correlation.symbols.map((row, ri) => (
                      <tr key={row}>
                        <td style={{
                          padding: '4px 6px',
                          color: 'var(--text-secondary)',
                          fontWeight: 500,
                        }}>
                          {row}
                        </td>
                        {correlation.matrix[ri].map((val, ci) => (
                          <td
                            key={ci}
                            style={{
                              padding: '6px 8px',
                              background: corrColor(val),
                              textAlign: 'center',
                              color: 'var(--text-primary)',
                              fontWeight: ri === ci ? 600 : 400,
                              borderRadius: 2,
                            }}
                            title={`${row} / ${correlation.symbols[ci]}: ${val.toFixed(3)}`}
                          >
                            {val.toFixed(2)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Sector exposure */}
          {sector && sector.sectors.length > 0 && (
            <Card
              title="Sector Exposure"
              titleInfo="Weights reflect your current open positions, not the selected time range."
              index={5}
            >
              {sector.sectors.map((s) => (
                <div key={s.sector} style={{ marginBottom: 8 }}>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 11,
                    fontFamily: 'var(--font-mono)',
                    marginBottom: 2,
                  }}>
                    <span style={{ color: 'var(--text-secondary)' }}>{s.sector}</span>
                    <span>{s.weight.toFixed(1)}%</span>
                  </div>
                  <div style={{
                    height: 6,
                    background: 'var(--bg-primary)',
                    borderRadius: 3,
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      width: `${s.weight}%`,
                      height: '100%',
                      background: 'var(--accent-blue)',
                      borderRadius: 3,
                      opacity: 0.7,
                    }} />
                  </div>
                </div>
              ))}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
