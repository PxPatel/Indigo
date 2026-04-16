import type { ReactNode } from 'react';

const STROKE_POS = '#00dc82';
const STROKE_NEG = '#ff4757';

type Pt = { x: number | null; y: number | null };

export type PnlDatum = { cumulativePnl: number };

/**
 * Custom Line `shape` for Recharts: draws the polyline as per-segment SVG lines
 * so stroke color can follow sign of P&L (green ≥ 0, red &lt; 0 at segment midpoint).
 */
export function createPnlPeriodLineShape(data: ReadonlyArray<PnlDatum>) {
  // Recharts passes Curve props; keep loose typing to satisfy ActiveShape overloads.
  return function PnlPeriodLineShape(props: { points?: ReadonlyArray<Pt> }) {
    const { points } = props;
    if (!points || points.length < 2 || data.length < 2) return null;

    const lines: ReactNode[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];
      if (
        p0?.x == null ||
        p0?.y == null ||
        p1?.x == null ||
        p1?.y == null ||
        i + 1 >= data.length
      ) {
        continue;
      }
      const mid = (data[i]!.cumulativePnl + data[i + 1]!.cumulativePnl) / 2;
      const stroke = mid >= 0 ? STROKE_POS : STROKE_NEG;
      lines.push(
        <line
          key={i}
          x1={p0.x}
          y1={p0.y}
          x2={p1.x}
          y2={p1.y}
          stroke={stroke}
          strokeWidth={2}
          fill="none"
        />,
      );
    }

    return <g>{lines}</g>;
  };
}
