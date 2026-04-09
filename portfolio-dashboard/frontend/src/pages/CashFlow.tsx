import { useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  BarChart,
  CartesianGrid,
} from 'recharts';
import { useState, useMemo, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../api/client';
import { MetricCard } from '../components/MetricCard';
import { Card } from '../components/Card';
import { ChartTooltip } from '../components/ChartTooltip';
import { LoadingShimmer } from '../components/LoadingShimmer';
import { formatCurrency } from '../utils/format';
import type { CashflowTrade } from '../api/client';

// --- Cashflow-specific tooltip with delayed ticker expansion ---

interface CashflowTooltipProps {
  active?: boolean;
  payload?: { value: number; name: string; color: string; payload: { trades?: CashflowTrade[] } }[];
  label?: string;
  expandedDate: string | null;
}

function CashflowTooltip({ active, payload, label, expandedDate }: CashflowTooltipProps) {
  if (!active || !payload?.length || !label) return null;

  const inflow  = payload.find((p) => p.name === 'Inflow')?.value ?? 0;
  const outflow = Math.abs(payload.find((p) => p.name === 'Outflow')?.value ?? 0);
  const net = inflow - outflow;
  const trades = payload[0]?.payload?.trades ?? [];
  const isExpanded = expandedDate === label;

  const buys  = trades.filter((t) => t.side === 'BUY');
  const sells = trades.filter((t) => t.side === 'SELL');

  return (
    <div style={{
      background: 'var(--bg-tertiary)',
      border: '1px solid var(--border-active)',
      borderRadius: 4,
      padding: '8px 12px',
      fontSize: 12,
      fontFamily: 'var(--font-mono)',
      minWidth: 200,
    }}>
      {/* Date header */}
      <div style={{ color: 'var(--text-secondary)', marginBottom: 6, fontSize: 11 }}>
        {label}
      </div>

      {/* Summary row — always visible */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {inflow > 0 && (
          <Row dot="var(--accent-green)" label="Inflow" value={formatCurrency(inflow)} />
        )}
        {outflow > 0 && (
          <Row dot="var(--accent-red)" label="Outflow" value={`(${formatCurrency(outflow)})`} valueColor="var(--accent-red)" />
        )}
        <div style={{
          marginTop: 2,
          paddingTop: 4,
          borderTop: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          gap: 16,
        }}>
          <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Net</span>
          <span style={{
            fontWeight: 600,
            color: net >= 0 ? 'var(--accent-green)' : 'var(--accent-red)',
          }}>
            {net >= 0 ? formatCurrency(net) : `(${formatCurrency(Math.abs(net))})`}
          </span>
        </div>
        {/* Overlay line values (cumulative/realized/cash lines in payload) */}
        {payload
          .filter((p) => p.name !== 'Inflow' && p.name !== 'Outflow')
          .map((p) => (
            <Row
              key={p.name}
              dot={p.color}
              label={p.name}
              value={formatCurrency(p.value)}
              valueColor={p.value >= 0 ? undefined : 'var(--accent-red)'}
            />
          ))}
      </div>

      {/* Expanded ticker breakdown */}
      <AnimatePresence>
        {isExpanded && trades.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{
              marginTop: 8,
              paddingTop: 8,
              borderTop: '1px solid var(--border)',
            }}>
              {buys.length > 0 && (
                <TradeGroup label="Bought" trades={buys} color="var(--accent-green)" />
              )}
              {sells.length > 0 && (
                <TradeGroup label="Sold" trades={sells} color="var(--accent-red)" />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hint when not yet expanded */}
      {!isExpanded && trades.length > 0 && (
        <div style={{
          marginTop: 6,
          fontSize: 10,
          color: 'var(--text-muted)',
          fontFamily: 'var(--font-body)',
        }}>
          Hold to see {trades.length} ticker{trades.length > 1 ? 's' : ''}…
        </div>
      )}
    </div>
  );
}

function Row({
  dot,
  label,
  value,
  valueColor,
}: {
  dot: string;
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot, flexShrink: 0 }} />
      <span style={{ color: 'var(--text-secondary)', fontSize: 11, flex: 1 }}>{label}:</span>
      <span style={{ color: valueColor ?? 'var(--text-primary)', fontWeight: 500 }}>{value}</span>
    </div>
  );
}

function TradeGroup({ label, trades, color }: { label: string; trades: CashflowTrade[]; color: string }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
        {label}
      </div>
      {trades.map((t) => (
        <div key={t.symbol} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 2 }}>
          <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{t.symbol}</span>
          <span style={{ color }}>{formatCurrency(t.amount)}</span>
        </div>
      ))}
    </div>
  );
}

// --- Page ---

export default function CashFlow() {
  const { data, isLoading } = useQuery({
    queryKey: ['cashflow'],
    queryFn: () => api.cashflow(),
  });

  const { data: cashAnchorData } = useQuery({
    queryKey: ['cash-anchor'],
    queryFn: api.getCashAnchor,
  });

  // Overlay line toggles — all on by default
  const [activeOverlays, setActiveOverlays] = useState<Set<string>>(
    () => new Set(['cumulative', 'cash']),
  );
  const toggleOverlay = useCallback((key: string) => {
    setActiveOverlays((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  // Timer-based hover expansion
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const expandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentLabelRef = useRef<string | null>(null);

  const handleChartMouseMove = useCallback((state: { activeLabel?: string | number }) => {
    const label = state?.activeLabel != null ? String(state.activeLabel) : null;
    if (label === currentLabelRef.current) return;
    currentLabelRef.current = label;

    // Cancel any pending expansion — do NOT call setExpandedDate here.
    // Avoiding setState on every bar change keeps re-renders to zero while skimming.
    // The tooltip naturally shows collapsed for any bar where expandedDate !== label.
    if (expandTimerRef.current) clearTimeout(expandTimerRef.current);

    if (label) {
      expandTimerRef.current = setTimeout(() => setExpandedDate(label), 500);
    }
  }, []);

  const handleChartMouseLeave = useCallback(() => {
    if (expandTimerRef.current) clearTimeout(expandTimerRef.current);
    currentLabelRef.current = null;
    setExpandedDate(null);
  }, []);

  // Build a date→cash_balance lookup from the anchor timeline
  const cashByDate = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of cashAnchorData?.cash_timeline ?? []) {
      map.set(entry.date, entry.cash_balance);
    }
    return map;
  }, [cashAnchorData]);

  const hasCashTimeline = cashByDate.size > 0;

  // Tooltip renderer — must be before any early return to satisfy rules of hooks
  const renderTooltip = useCallback(
    (props: object) => <CashflowTooltip {...(props as CashflowTooltipProps)} expandedDate={expandedDate} />,
    [expandedDate],
  );

  if (isLoading || !data) return <LoadingShimmer height={600} />;

  const { timeline, monthly, by_symbol, stats } = data;

  const flowData = timeline.map((t) => ({
    date: t.date,
    inflow: t.inflow,
    outflow: -t.outflow,
    cumulative: t.cumulative_invested,
    realized_pnl: t.cumulative_realized_pnl,
    trades: t.trades,
    ...(hasCashTimeline && cashByDate.has(t.date)
      ? { cash: cashByDate.get(t.date) }
      : {}),
  }));

  const monthlyData = monthly.map((m) => ({
    month: m.month,
    inflow: m.inflow,
    outflow: -m.outflow,
  }));

  const currentCash = cashAnchorData?.cash_timeline?.at(-1)?.cash_balance ?? null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Stats */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <MetricCard
          index={0}
          label="Net Invested"
          value={formatCurrency(stats.net_invested)}
          tooltip="Total capital deployed (buys + deposits) minus capital returned (sells + withdrawals). Net cash you've put to work."
        />
        <MetricCard
          index={1}
          label="Current Cash"
          value={currentCash !== null ? formatCurrency(currentCash) : 'N/A'}
          tooltip="Estimated cash in account, calculated from a known balance anchor and adjusted for every trade and transfer since."
        />
        <MetricCard
          index={2}
          label="Largest Buy"
          value={formatCurrency(stats.largest_buy)}
          tooltip="Single largest buy order by dollar amount across all your transactions."
        />
        <MetricCard
          index={3}
          label="Largest Sell"
          value={formatCurrency(stats.largest_sell)}
          tooltip="Single largest sell order by dollar amount across all your transactions."
        />
        <MetricCard
          index={4}
          label="Avg Transaction"
          value={formatCurrency(stats.avg_transaction_size)}
          tooltip="Average dollar size across all buy and sell orders."
        />
      </div>

      {/* Main flow chart */}
      <Card title="Capital Flow Timeline" index={1}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
          {/* Static bar legend */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, fontFamily: 'var(--font-body)' }}>
            <LegendDot color="var(--accent-green)" label="Inflow" />
            <LegendDot color="var(--accent-red)" label="Outflow" />
          </div>
          {/* Toggleable line overlays */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <OverlayToggle
              active={activeOverlays.has('cumulative')}
              color="var(--accent-cyan)"
              label="Cumulative Net"
              onToggle={() => toggleOverlay('cumulative')}
            />
            <OverlayToggle
              active={activeOverlays.has('realized')}
              color="var(--accent-purple)"
              label="Realized P&L"
              onToggle={() => toggleOverlay('realized')}
            />
            {hasCashTimeline && (
              <OverlayToggle
                active={activeOverlays.has('cash')}
                color="var(--accent-amber)"
                label="Cash Balance"
                onToggle={() => toggleOverlay('cash')}
              />
            )}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart
            data={flowData}
            onMouseMove={handleChartMouseMove}
            onMouseLeave={handleChartMouseLeave}
          >
            <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
              tickLine={false}
              axisLine={{ stroke: 'var(--border)' }}
              tickFormatter={(v) => v.slice(5)}
              minTickGap={40}
            />
            <YAxis
              tick={{ fontSize: 10, fill: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
              width={55}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fontSize: 10, fill: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
              width={55}
            />
            <Tooltip content={renderTooltip} />
            <Bar dataKey="inflow" fill="var(--accent-green)" opacity={0.8} name="Inflow" />
            <Bar dataKey="outflow" fill="var(--accent-red)" opacity={0.8} name="Outflow" />
            {activeOverlays.has('cumulative') && (
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="cumulative"
                stroke="var(--accent-cyan)"
                strokeWidth={2}
                dot={false}
                name="Cumulative Net"
              />
            )}
            {activeOverlays.has('realized') && (
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="realized_pnl"
                stroke="var(--accent-purple)"
                strokeWidth={2}
                dot={false}
                name="Realized P&L"
              />
            )}
            {hasCashTimeline && activeOverlays.has('cash') && (
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="cash"
                stroke="var(--accent-amber)"
                strokeWidth={2}
                dot={false}
                strokeDasharray="5 3"
                name="Cash Balance"
                connectNulls
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </Card>

      {/* Bottom row */}
      <div style={{ display: 'flex', gap: 16 }}>
        {/* Monthly summary */}
        <Card title="Monthly Cash Flow" style={{ flex: 1 }} index={2}>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={monthlyData}>
              <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" />
              <XAxis
                dataKey="month"
                tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                tickLine={false}
                axisLine={{ stroke: 'var(--border)' }}
              />
              <YAxis
                tick={{ fontSize: 10, fill: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                width={55}
              />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="inflow" fill="var(--accent-green)" opacity={0.8} name="Inflows" />
              <Bar dataKey="outflow" fill="var(--accent-red)" opacity={0.8} name="Outflows" />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        {/* By symbol */}
        <Card title="Cash Deployed by Symbol" style={{ flex: 1 }} index={3}>
          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            {by_symbol.map((s) => {
              const maxVal = Math.max(...by_symbol.map((x) => Math.abs(x.net_deployed)));
              const pct = maxVal > 0 ? (Math.abs(s.net_deployed) / maxVal) * 100 : 0;
              const isPositive = s.net_deployed >= 0;
              return (
                <div key={s.symbol} style={{ marginBottom: 8 }}>
                  <div style={{
                    display: 'flex', justifyContent: 'space-between',
                    fontSize: 12, fontFamily: 'var(--font-mono)', marginBottom: 2,
                  }}>
                    <span style={{ fontWeight: 600 }}>{s.symbol}</span>
                    <span style={{ color: isPositive ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                      {formatCurrency(s.net_deployed)}
                    </span>
                  </div>
                  <div style={{ height: 6, background: 'var(--bg-primary)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{
                      width: `${pct}%`, height: '100%', borderRadius: 3, opacity: 0.7,
                      background: isPositive ? 'var(--accent-green)' : 'var(--accent-red)',
                    }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}

function LegendDot({ color, label, line }: { color: string; label: string; line?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--text-secondary)' }}>
      {line ? (
        <div style={{ width: 16, height: 2, background: color, borderRadius: 1 }} />
      ) : (
        <div style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
      )}
      {label}
    </div>
  );
}

function OverlayToggle({ active, color, label, onToggle }: {
  active: boolean;
  color: string;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        padding: '3px 8px',
        borderRadius: 4,
        border: `1px solid ${active ? color : 'var(--border)'}`,
        background: active ? `color-mix(in srgb, ${color} 12%, transparent)` : 'transparent',
        color: active ? color : 'var(--text-muted)',
        fontSize: 11,
        fontFamily: 'var(--font-body)',
        cursor: 'pointer',
        transition: 'all 0.15s ease',
        opacity: active ? 1 : 0.55,
      }}
    >
      <div style={{ width: 14, height: 2, background: active ? color : 'var(--text-muted)', borderRadius: 1, flexShrink: 0 }} />
      {label}
    </button>
  );
}
