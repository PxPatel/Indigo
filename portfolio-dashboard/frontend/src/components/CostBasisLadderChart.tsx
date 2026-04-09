import type { CSSProperties } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { CostBasisMergedLevel } from '../api/client';
import { padPriceDomain, pickPriceTickStep } from './costBasisLadderAxis';

type Row = {
  price: number;
  barPct: number;
  dateLabel: string;
  key: string;
};

function buildRows(merged: CostBasisMergedLevel[]): Row[] {
  const maxShares = Math.max(...merged.map((m) => m.shares), 1e-9);
  return merged.map((m, i) => ({
    price: m.price,
    barPct: (m.shares / maxShares) * 100,
    dateLabel:
      m.date_start === m.date_end ? m.date_start : `${m.date_start} – ${m.date_end}`,
    key: `${m.price}-${i}`,
  }));
}

function LadderTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: Row }[];
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div
      style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        padding: '8px 10px',
        fontSize: 11,
        fontFamily: 'var(--font-mono)',
        color: 'var(--text-primary)',
      }}
    >
      <div>${row.price.toFixed(2)}</div>
      <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>{row.dateLabel}</div>
    </div>
  );
}

export function CostBasisLadderChart({
  mergedLevels,
  currentPrice,
  compact,
  showDateLabels,
  modal = false,
}: {
  mergedLevels: CostBasisMergedLevel[];
  currentPrice: number;
  compact: boolean;
  showDateLabels?: boolean;
  /** Taller cap + scroll; narrower max width for modal layout */
  modal?: boolean;
}) {
  if (mergedLevels.length === 0) {
    return (
      <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 12 }}>
        No lot data to display.
      </div>
    );
  }

  const rows = buildRows(mergedLevels);
  const prices = mergedLevels.map((m) => m.price);
  const { min, max } = padPriceDomain(prices, currentPrice);
  const spread = max - min;
  const tickStep = pickPriceTickStep(spread);
  const ticks: number[] = [];
  let t = Math.ceil(min / tickStep) * tickStep;
  const guard = 500;
  let n = 0;
  while (t <= max + tickStep * 0.01 && n < guard) {
    ticks.push(roundTick(t));
    t += tickStep;
    n += 1;
  }

  const rowH = compact ? 18 : modal ? 26 : 28;
  const rawH = Math.max(compact ? 140 : 160, rows.length * rowH + 40);
  const h = modal ? Math.min(rawH, 420) : compact ? Math.min(rawH, 300) : rawH;

  const wrapStyle: CSSProperties = {
    width: '100%',
    maxWidth: compact ? 'min(100%, 480px)' : modal ? 'min(100%, 680px)' : 'min(100%, 560px)',
    margin: '0 auto',
    position: 'relative',
    ...(modal
      ? {
          maxHeight: 'min(400px, 52vh)',
          overflowY: 'auto',
          overflowX: 'hidden',
        }
      : {}),
  };

  return (
    <div style={wrapStyle}>
      <ResponsiveContainer width="100%" height={h}>
        <BarChart
          data={rows}
          layout="vertical"
          margin={{
            top: 8,
            right: showDateLabels ? (compact ? 80 : 108) : compact ? 8 : 12,
            left: compact ? 4 : 8,
            bottom: 8,
          }}
          barCategoryGap={compact ? 5 : 8}
        >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" horizontal={false} />
              <XAxis
                type="number"
                domain={[0, 100]}
                tick={false}
                axisLine={false}
              />
              <YAxis
                type="number"
                dataKey="price"
                domain={[min, max]}
                ticks={ticks.length ? ticks : undefined}
                tickFormatter={(v) => `$${v}`}
                width={compact ? 52 : modal ? 58 : 64}
                tick={{ fontSize: compact ? 9 : modal ? 10 : 10, fill: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
                axisLine={{ stroke: 'var(--border)' }}
              />
              <Tooltip content={<LadderTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
              <ReferenceLine
                y={currentPrice}
                stroke="var(--accent-cyan)"
                strokeWidth={compact ? 1.5 : modal ? 2 : 2}
                strokeDasharray="4 3"
                label={{
                  value: `$${currentPrice.toFixed(2)}`,
                  position: 'right',
                  fill: 'var(--accent-cyan)',
                  fontSize: compact ? 10 : 11,
                  fontFamily: 'var(--font-mono)',
                }}
              />
              <Bar
                dataKey="barPct"
                radius={[0, 2, 2, 0]}
                isAnimationActive={false}
                barSize={compact ? 14 : modal ? 20 : 22}
              >
                {rows.map((row) => (
                  <Cell
                    key={row.key}
                    fill={
                      row.price < currentPrice
                        ? 'var(--accent-green)'
                        : 'var(--accent-red)'
                    }
                  />
                ))}
                {showDateLabels ? (
                  <LabelList
                    dataKey="dateLabel"
                    position="right"
                    style={{
                      fill: 'var(--text-muted)',
                      fontSize: compact ? 10 : 11,
                      fontFamily: 'var(--font-body)',
                    }}
                  />
                ) : null}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
    </div>
  );
}

function roundTick(x: number): number {
  if (Math.abs(x) >= 100) return Math.round(x);
  if (Math.abs(x) >= 10) return Math.round(x * 10) / 10;
  return Math.round(x * 100) / 100;
}
