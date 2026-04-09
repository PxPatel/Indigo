import { useEffect, useRef } from 'react';
import {
  createChart,
  createSeriesMarkers,
  CandlestickSeries,
  LineSeries,
  ColorType,
  LineStyle,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type SeriesMarker,
  type Time,
} from 'lightweight-charts';
import type { OHLCVPoint, ClusteredTrade, RoundTrip } from '../api/client';

export type ChartMode = 'candlestick' | 'line';

interface Props {
  ohlcv: OHLCVPoint[];
  trades: ClusteredTrade[];
  roundTrips: RoundTrip[];
  mode: ChartMode;
  height?: number;
}

const T = {
  bg: '#0d0d14',
  border: '#1e1e2e',
  text: '#6b7280',
  green: '#00dc82',
  red: '#ff4757',
  purple: '#8b5cf6',
};

function chartBarTime(d: OHLCVPoint): Time {
  if (d.time != null && d.time !== undefined) return d.time as Time;
  return d.date as Time;
}

function compareBars(a: OHLCVPoint, b: OHLCVPoint): number {
  if (a.time != null && b.time != null) return a.time - b.time;
  if (a.time != null) return -1;
  if (b.time != null) return 1;
  return a.date.localeCompare(b.date);
}

function buildMarkers(
  trades: ClusteredTrade[],
  firstBarUtcByDay: Map<string, number>,
): SeriesMarker<Time>[] {
  return [...trades]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((t) => {
      const isBuy = t.side === 'BUY';
      const prefix = t.count > 1 ? `${t.count}× ` : '';
      const pnlVal = t.realized_pnl ?? t.unrealized_pnl;
      const pnlLabel =
        pnlVal != null
          ? ` (${pnlVal >= 0 ? '+' : ''}$${Math.abs(pnlVal).toFixed(0)}${t.realized_pnl == null ? '*' : ''})`
          : '';
      const tm =
        firstBarUtcByDay.get(t.date) != null
          ? (firstBarUtcByDay.get(t.date)! as Time)
          : (t.date as Time);
      return {
        time: tm,
        position: isBuy ? 'belowBar' : 'aboveBar',
        color: isBuy ? T.green : T.red,
        shape: isBuy ? 'arrowUp' : 'arrowDown',
        text: `${prefix}${isBuy ? 'B' : 'S'} ${t.quantity}@$${t.price.toFixed(2)}${pnlLabel}`,
        size: t.count > 1 ? 2 : 1,
      } satisfies SeriesMarker<Time>;
    });
}

export function TradeChart({ ohlcv, trades, roundTrips, mode, height = 420 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const rtSeriesRef = useRef<ISeriesApi<'Line'>[]>([]);

  useEffect(() => {
    if (!containerRef.current || ohlcv.length === 0) return;

    const bars = [...ohlcv].sort(compareBars);
    const tMin = bars[0]!.date;
    const tMax = bars[bars.length - 1]!.date;
    const isIntraday = bars.some((b) => b.time != null);
    const firstBarUtcByDay = new Map<string, number>();
    for (const b of bars) {
      if (b.time != null && !firstBarUtcByDay.has(b.date)) {
        firstBarUtcByDay.set(b.date, b.time);
      }
    }
    // Only overlays whose times lie in the loaded bar window. Round-trip lines
    // spanning months/years otherwise extend the chart time scale and the
    // crosshair snaps to those distant endpoints.
    const tradesInView = trades.filter((x) => x.date >= tMin && x.date <= tMax);
    const roundTripsInView = roundTrips.filter(
      (rt) => rt.buy_date >= tMin && rt.sell_date <= tMax,
    );

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: T.bg },
        textColor: T.text,
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: T.border },
        horzLines: { color: T.border },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: T.border },
      timeScale: {
        borderColor: T.border,
        timeVisible: true,
        secondsVisible: false,
        fixLeftEdge: false,
        fixRightEdge: false,
      },
      width: containerRef.current.clientWidth,
      height,
    });
    chartRef.current = chart;

    // --- Main series (v5 API: chart.addSeries) ---
    let mainSeries: ISeriesApi<'Candlestick' | 'Line'>;

    if (mode === 'candlestick') {
      const cs = chart.addSeries(CandlestickSeries, {
        upColor: T.green,
        downColor: T.red,
        borderUpColor: T.green,
        borderDownColor: T.red,
        wickUpColor: T.green,
        wickDownColor: T.red,
      });
      cs.setData(
        bars.map((d) => ({
          time: chartBarTime(d),
          open: d.open,
          high: d.high,
          low: d.low,
          close: d.close,
        }))
      );
      mainSeries = cs;
    } else {
      const ls = chart.addSeries(LineSeries, {
        color: T.purple,
        lineWidth: 2,
        crosshairMarkerVisible: true,
        priceLineVisible: false,
      });
      ls.setData(bars.map((d) => ({ time: chartBarTime(d), value: d.close })));
      mainSeries = ls;
    }

    // --- Trade markers (v5: createSeriesMarkers plugin) ---
    if (tradesInView.length > 0) {
      const markers = buildMarkers(tradesInView, firstBarUtcByDay);
      // v5 uses createSeriesMarkers; fall back to series.setMarkers if plugin unavailable
      try {
        createSeriesMarkers(mainSeries as ISeriesApi<'Line'>, markers);
      } catch {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mainSeries as any).setMarkers?.(markers);
      }
    }

    // --- Round-trip lines (skip on intraday: date strings are incompatible with unix time scale) ---
    rtSeriesRef.current = [];
    if (!isIntraday) {
      for (const rt of roundTripsInView.slice(0, 40)) {
        if (rt.buy_date === rt.sell_date) continue;
        const color =
          rt.realized_pnl >= 0
            ? 'rgba(0,220,130,0.25)'
            : 'rgba(255,71,87,0.25)';
        const rts: ISeriesApi<'Line'> = chart.addSeries(LineSeries, {
          color,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          crosshairMarkerVisible: false,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        rts.setData([
          { time: rt.buy_date as Time, value: rt.buy_price },
          { time: rt.sell_date as Time, value: rt.sell_price },
        ]);
        rtSeriesRef.current.push(rts);
      }
    }

    chart.timeScale().fitContent();

    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && chartRef.current) chartRef.current.resize(w, height);
    });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      rtSeriesRef.current = [];
    };
  }, [ohlcv, trades, roundTrips, mode, height]);

  return <div ref={containerRef} style={{ width: '100%', height }} />;
}
