import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from 'recharts';
import { useMemo } from 'react';
import { api } from '../api/client';
import { usePortfolioStore } from '../stores/portfolioStore';
import { getTimeRangeBounds } from '../utils/timeRange';
import { TimeRangeControl } from '../components/TimeRangeControl';
import { Card } from '../components/Card';
import { ChartTooltip } from '../components/ChartTooltip';
import { LoadingShimmer } from '../components/LoadingShimmer';
import { TooltipWrap } from '../components/Tooltip';
import { formatPercent } from '../utils/format';

const BENCHMARKS = ['SPY', 'QQQ', 'IWM', 'DIA'];

export default function Benchmark() {
  const { selectedBenchmark, setBenchmark, setManualEntryModalOpen, timeRangePreset, customDays } =
    usePortfolioStore();

  const { from, to } = useMemo(
    () => getTimeRangeBounds(timeRangePreset, customDays),
    [timeRangePreset, customDays],
  );

  const { data, isLoading } = useQuery({
    queryKey: ['benchmark', selectedBenchmark, from, to],
    queryFn: () => api.benchmark(selectedBenchmark, from, to),
  });

  const { data: cashAnchor, isLoading: loadingCashAnchor } = useQuery({
    queryKey: ['cash-anchor'],
    queryFn: api.getCashAnchor,
  });

  // Relative performance chart data
  const relativeData = useMemo(() => {
    if (!data?.series) return [];
    let cumRelative = 0;
    return data.series.map((s, i) => {
      if (i > 0) {
        const prev = data.series[i - 1];
        const portRet = (s.portfolio_indexed - prev.portfolio_indexed) / prev.portfolio_indexed;
        const benchRet = (s.benchmark_indexed - prev.benchmark_indexed) / prev.benchmark_indexed;
        cumRelative += (portRet - benchRet) * 100;
      }
      return {
        date: s.date,
        relative: cumRelative,
        positiveRelative: cumRelative >= 0 ? cumRelative : 0,
        negativeRelative: cumRelative < 0 ? cumRelative : 0,
      };
    });
  }, [data]);

  if (isLoading || !data || loadingCashAnchor || !cashAnchor) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <TimeRangeControl />
        <LoadingShimmer height={600} />
      </div>
    );
  }

  const { series, stats } = data;
  const showNoAnchorWarning = cashAnchor.anchor === null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <TimeRangeControl />
      {showNoAnchorWarning && (
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
              The portfolio return line and comparison stats use{' '}
              <strong style={{ color: 'var(--text-primary)' }}>signed equity market value only</strong>
              — implied cash is excluded. That can skew the curve versus a full net account (for example,
              large idle cash looks like underperformance vs the ETF). Set a cash balance anchor
              (Manual entries → Cash Balance) so the series matches{' '}
              <strong style={{ color: 'var(--text-primary)' }}>net account</strong> wealth like the Risk
              page.
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

      {/* Benchmark selector */}
      <div style={{ display: 'flex', gap: 6 }}>
        {BENCHMARKS.map((b) => (
          <button
            key={b}
            onClick={() => setBenchmark(b)}
            style={{
              padding: '6px 16px',
              fontSize: 12,
              fontFamily: 'var(--font-mono)',
              fontWeight: 600,
              background: selectedBenchmark === b ? 'var(--accent-blue)' : 'var(--bg-secondary)',
              color: selectedBenchmark === b ? '#fff' : 'var(--text-secondary)',
              border: `1px solid ${selectedBenchmark === b ? 'var(--accent-blue)' : 'var(--border)'}`,
              borderRadius: 6,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            {b}
          </button>
        ))}
      </div>

      <Card title={`Portfolio vs ${selectedBenchmark} — indexed to 100`} index={0}>
        <div style={{
          fontSize: 11,
          color: 'var(--text-muted)',
          marginBottom: 12,
          lineHeight: 1.45,
          maxWidth: 720,
        }}>
          The portfolio line compounds daily returns with Fund Transfer days adjusted for external cash.
          The benchmark is buy-and-hold total return for the ETF. CSV-only deposits still need fund
          transfer entries to strip from returns.
        </div>
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={series}>
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
              width={45}
            />
            <Tooltip content={<ChartTooltip valueFormat="number" />} />
            <ReferenceLine y={100} stroke="var(--text-muted)" strokeDasharray="5 5" />
            <Line
              type="monotone"
              dataKey="portfolio_indexed"
              stroke="var(--accent-purple)"
              strokeWidth={2.5}
              dot={false}
              name="Portfolio (return)"
            />
            <Line
              type="monotone"
              dataKey="benchmark_indexed"
              stroke="var(--accent-cyan)"
              strokeWidth={2.5}
              dot={false}
              name={selectedBenchmark}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </Card>

      {/* Relative performance */}
      <Card title="Relative performance (cumulative daily excess)" index={1}>
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={relativeData}>
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
              tickFormatter={(v) => `${v.toFixed(0)}%`}
              width={45}
            />
            <Tooltip content={<ChartTooltip valueFormat="percent" />} />
            <ReferenceLine y={0} stroke="var(--text-muted)" strokeWidth={1.5} />
            <Area
              type="monotone"
              dataKey="positiveRelative"
              stroke="none"
              fill="var(--accent-green)"
              fillOpacity={0.2}
              name="Outperformance"
            />
            <Area
              type="monotone"
              dataKey="negativeRelative"
              stroke="none"
              fill="var(--accent-red)"
              fillOpacity={0.2}
              name="Underperformance"
            />
            <Line
              type="monotone"
              dataKey="relative"
              stroke="var(--accent-purple)"
              strokeWidth={1.5}
              dot={false}
              name="Relative"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </Card>

      {/* Stats grid */}
      <Card title="Comparison Statistics" index={2}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: 16,
          fontSize: 12,
          fontFamily: 'var(--font-mono)',
        }}>
          {[
            { label: 'Portfolio Total Return', value: formatPercent(stats.portfolio_total_return), color: stats.portfolio_total_return, tip: 'Cumulative return on the flow-adjusted return index over the date range (not raw account balance growth).' },
            { label: `${selectedBenchmark} Total Return`, value: formatPercent(stats.benchmark_total_return), color: stats.benchmark_total_return, tip: `Cumulative buy-and-hold return for ${selectedBenchmark} over the same period.` },
            { label: 'Portfolio Annualized', value: formatPercent(stats.portfolio_annualized), color: stats.portfolio_annualized, tip: 'Annualized return from the flow-adjusted portfolio series (compound growth, same window as the chart).' },
            { label: `${selectedBenchmark} Annualized`, value: formatPercent(stats.benchmark_annualized), color: stats.benchmark_annualized, tip: `${selectedBenchmark} return scaled to an annual rate over the same period.` },
            { label: 'Tracking Error', value: `${stats.tracking_error.toFixed(2)}%`, tip: 'Annualized std dev of daily differences (flow-adjusted portfolio return minus benchmark daily return). Lower = closer tracking.' },
            { label: 'Information Ratio', value: stats.information_ratio.toFixed(3), tip: 'Excess annualized return per unit of tracking error. Uses the same flow-adjusted portfolio returns as the chart.' },
            { label: 'Up Capture', value: `${stats.up_capture.toFixed(1)}%`, tip: "On days the benchmark gained, your flow-adjusted portfolio captured this % of the benchmark’s gain. Above 100% means you outpaced the benchmark on up days." },
            { label: 'Down Capture', value: `${stats.down_capture.toFixed(1)}%`, tip: "On days the benchmark fell, your flow-adjusted return vs the benchmark’s loss. Below 100% means you lost less on those days." },
            { label: 'Correlation', value: stats.correlation.toFixed(3), tip: 'Correlation between flow-adjusted portfolio daily returns and benchmark daily returns.' },
          ].map((item) => (
            <TooltipWrap key={item.label} tip={item.tip}>
              <div style={{
                padding: '10px 12px',
                background: 'var(--bg-tertiary)',
                borderRadius: 4,
              }}>
                <div style={{ color: 'var(--text-muted)', fontSize: 10, marginBottom: 4 }}>
                  {item.label}
                </div>
                <div style={{
                  fontWeight: 600,
                  fontSize: 14,
                  color: 'color' in item && item.color !== undefined
                    ? (item.color as number) >= 0 ? 'var(--accent-green)' : 'var(--accent-red)'
                    : 'var(--text-primary)',
                }}>
                  {item.value}
                </div>
              </div>
            </TooltipWrap>
          ))}
        </div>
      </Card>
    </div>
  );
}
