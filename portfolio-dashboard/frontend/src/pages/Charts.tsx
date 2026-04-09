import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { subDays, subMonths, subYears, format } from 'date-fns';
import { api } from '../api/client';
import { TradeChart, type ChartMode } from '../components/TradeChart';
import { Card } from '../components/Card';
import { LoadingShimmer } from '../components/LoadingShimmer';
import { formatCurrency, pnlColor } from '../utils/format';

const TIMEFRAMES = ['1D', '5D', '1M', '3M', '6M', '1Y', 'ALL'] as const;
type Timeframe = typeof TIMEFRAMES[number];

function getDateRange(tf: Timeframe): { from?: string; to?: string } {
  const now = new Date();
  const to = format(now, 'yyyy-MM-dd');
  switch (tf) {
    case '1D':  return { from: format(subDays(now, 2), 'yyyy-MM-dd'), to };
    case '5D':  return { from: format(subDays(now, 7), 'yyyy-MM-dd'), to };
    case '1M':  return { from: format(subMonths(now, 1), 'yyyy-MM-dd'), to };
    case '3M':  return { from: format(subMonths(now, 3), 'yyyy-MM-dd'), to };
    case '6M':  return { from: format(subMonths(now, 6), 'yyyy-MM-dd'), to };
    case '1Y':  return { from: format(subYears(now, 1), 'yyyy-MM-dd'), to };
    case 'ALL': return {};
  }
}

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '4px 10px',
        fontSize: 11,
        fontFamily: 'var(--font-mono)',
        fontWeight: 500,
        background: active ? 'var(--accent-blue)' : 'var(--bg-tertiary)',
        color: active ? '#fff' : 'var(--text-secondary)',
        border: 'none',
        borderRadius: 4,
        cursor: 'pointer',
        transition: 'all 0.15s ease',
      }}
    >
      {children}
    </button>
  );
}

export default function Charts() {
  const [inputValue, setInputValue] = useState('');
  const [symbol, setSymbol] = useState('');
  const [timeframe, setTimeframe] = useState<Timeframe>('3M');
  const [mode, setMode] = useState<ChartMode>('candlestick');

  const { from, to } = useMemo(() => getDateRange(timeframe), [timeframe]);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['symbol-chart', symbol, from, to, timeframe],
    queryFn: () => api.symbolChart(symbol, from, to, timeframe),
    enabled: symbol.length > 0,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const s = inputValue.trim().toUpperCase();
    if (s) setSymbol(s);
  }

  const pnl =
    data && data.shares_held > 0 && data.avg_cost > 0 && data.current_price > 0
      ? (data.current_price - data.avg_cost) * data.shares_held
      : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Symbol search + controls */}
      <Card index={0}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {/* Symbol input */}
          <form onSubmit={handleSearch} style={{ display: 'flex', gap: 6 }}>
            <input
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value.toUpperCase())}
              placeholder="Ticker (e.g. NVDA)"
              style={{
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-mono)',
                fontSize: 13,
                fontWeight: 600,
                padding: '6px 10px',
                width: 140,
                outline: 'none',
                textTransform: 'uppercase',
              }}
              onFocus={(e) => (e.target.style.borderColor = 'var(--border-active)')}
              onBlur={(e) => (e.target.style.borderColor = 'var(--border)')}
            />
            <button
              type="submit"
              style={{
                padding: '6px 14px',
                background: 'var(--accent-blue)',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                fontSize: 12,
                fontFamily: 'var(--font-mono)',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Load
            </button>
          </form>

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          {/* Timeframe */}
          <div style={{ display: 'flex', gap: 4 }}>
            {TIMEFRAMES.map((tf) => (
              <ToggleButton
                key={tf}
                active={timeframe === tf}
                onClick={() => setTimeframe(tf)}
              >
                {tf}
              </ToggleButton>
            ))}
          </div>

          {/* Chart mode */}
          <div style={{ display: 'flex', gap: 4, borderLeft: '1px solid var(--border)', paddingLeft: 12 }}>
            <ToggleButton active={mode === 'candlestick'} onClick={() => setMode('candlestick')}>
              Candles
            </ToggleButton>
            <ToggleButton active={mode === 'line'} onClick={() => setMode('line')}>
              Line
            </ToggleButton>
          </div>
        </div>
      </Card>

      {/* Empty state */}
      {!symbol && (
        <Card index={1}>
          <div style={{
            height: 300,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            gap: 8,
            color: 'var(--text-muted)',
          }}>
            <span style={{ fontSize: 32 }}>📈</span>
            <span style={{ fontSize: 13 }}>Enter a ticker above to load the chart</span>
            <span style={{ fontSize: 11 }}>
              Your portfolio tickers are suggested automatically
            </span>
          </div>
        </Card>
      )}

      {/* Loading */}
      {symbol && isLoading && (
        <Card index={1}>
          <LoadingShimmer height={420} />
        </Card>
      )}

      {/* Error */}
      {symbol && isError && (
        <Card index={1}>
          <div style={{
            height: 200,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--accent-red)',
            fontSize: 13,
          }}>
            {error instanceof Error ? error.message : `Could not load data for ${symbol}`}
          </div>
        </Card>
      )}

      {/* Chart */}
      {data && !isLoading && (
        <>
          {/* Symbol header + position summary */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {/* Symbol badge */}
            <div style={{
              padding: '10px 16px',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              fontFamily: 'var(--font-mono)',
            }}>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{data.symbol}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                {formatCurrency(data.current_price)} current
              </div>
            </div>

            {data.has_trade_data && data.shares_held > 0 && (
              <>
                <StatBox label="Shares Held" value={data.shares_held.toFixed(4)} />
                <StatBox label="Avg Cost" value={formatCurrency(data.avg_cost)} />
                {pnl != null && (
                  <StatBox
                    label="Unrealized P&L"
                    value={formatCurrency(pnl)}
                    color={pnlColor(pnl)}
                  />
                )}
              </>
            )}

            {!data.has_trade_data && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                padding: '10px 16px',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                fontSize: 12,
                color: 'var(--text-muted)',
              }}>
                No trades found for {data.symbol} in your portfolio — chart only
              </div>
            )}
          </div>

          {/* Chart card */}
          <Card index={1} style={{ padding: 0, overflow: 'hidden' }}>
            {data.ohlcv.length === 0 ? (
              <div style={{
                height: 420,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-muted)',
                fontSize: 13,
              }}>
                No price data available for {data.symbol} in this date range
              </div>
            ) : (
              <TradeChart
                ohlcv={data.ohlcv}
                trades={data.trades}
                roundTrips={data.round_trips}
                mode={mode}
                height={420}
              />
            )}
          </Card>

          {/* Trade log */}
          {data.has_trade_data && data.trades.length > 0 && (
            <Card title="Trade Log" index={2}>
              <table style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: 12,
                fontFamily: 'var(--font-mono)',
              }}>
                <thead>
                  <tr style={{ color: 'var(--text-muted)', fontSize: 10, textAlign: 'left' }}>
                    <th style={{ padding: '4px 8px' }}>Date</th>
                    <th style={{ padding: '4px 8px' }}>Side</th>
                    <th style={{ padding: '4px 8px', textAlign: 'right' }}>Qty</th>
                    <th style={{ padding: '4px 8px', textAlign: 'right' }}>Fill Price</th>
                    <th style={{ padding: '4px 8px', textAlign: 'right' }}>Total</th>
                    <th style={{ padding: '4px 8px', textAlign: 'right' }}>P&L</th>
                    <th style={{ padding: '4px 8px' }}>Fills</th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.trades]
                    .sort((a, b) => b.date.localeCompare(a.date))
                    .map((t, i) => {
                      const isBuy = t.side === 'BUY';
                      const pnlVal = t.realized_pnl ?? t.unrealized_pnl;
                      return (
                        <tr
                          key={i}
                          style={{
                            background: i % 2 === 0 ? 'var(--bg-secondary)' : 'var(--bg-tertiary)',
                          }}
                        >
                          <td style={{ padding: '6px 8px', color: 'var(--text-secondary)' }}>
                            {t.date}
                          </td>
                          <td style={{ padding: '6px 8px' }}>
                            <span style={{
                              padding: '1px 6px',
                              borderRadius: 3,
                              fontSize: 10,
                              fontWeight: 700,
                              background: isBuy ? 'rgba(0,220,130,0.15)' : 'rgba(255,71,87,0.15)',
                              color: isBuy ? 'var(--accent-green)' : 'var(--accent-red)',
                            }}>
                              {t.side}
                            </span>
                          </td>
                          <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                            {t.quantity}
                          </td>
                          <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                            {formatCurrency(t.price)}
                          </td>
                          <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                            {formatCurrency(t.total_amount)}
                          </td>
                          <td style={{
                            padding: '6px 8px',
                            textAlign: 'right',
                            color: pnlVal != null ? pnlColor(pnlVal) : 'var(--text-muted)',
                            fontWeight: 600,
                          }}>
                            {pnlVal != null
                              ? `${pnlVal >= 0 ? '+' : ''}${formatCurrency(pnlVal)}${t.realized_pnl == null ? '*' : ''}`
                              : '—'}
                          </td>
                          <td style={{ padding: '6px 8px', color: 'var(--text-muted)' }}>
                            {t.count > 1 ? `${t.count} fills` : ''}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', padding: '6px 8px' }}>
                * open position — P&L vs fill price at current market price
              </div>
            </Card>
          )}

          {/* Round trips summary */}
          {data.has_trade_data && data.round_trips.length > 0 && (
            <Card title="Round Trips" index={3}>
              <table style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: 12,
                fontFamily: 'var(--font-mono)',
              }}>
                <thead>
                  <tr style={{ color: 'var(--text-muted)', fontSize: 10, textAlign: 'left' }}>
                    <th style={{ padding: '4px 8px' }}>Bought</th>
                    <th style={{ padding: '4px 8px' }}>Sold</th>
                    <th style={{ padding: '4px 8px', textAlign: 'right' }}>Qty</th>
                    <th style={{ padding: '4px 8px', textAlign: 'right' }}>Buy Price</th>
                    <th style={{ padding: '4px 8px', textAlign: 'right' }}>Sell Price</th>
                    <th style={{ padding: '4px 8px', textAlign: 'right' }}>Realized P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {data.round_trips.map((rt, i) => (
                    <tr
                      key={i}
                      style={{
                        background: i % 2 === 0 ? 'var(--bg-secondary)' : 'var(--bg-tertiary)',
                      }}
                    >
                      <td style={{ padding: '6px 8px', color: 'var(--accent-green)' }}>{rt.buy_date}</td>
                      <td style={{ padding: '6px 8px', color: 'var(--accent-red)' }}>{rt.sell_date}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' }}>{rt.quantity}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' }}>{formatCurrency(rt.buy_price)}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' }}>{formatCurrency(rt.sell_price)}</td>
                      <td style={{
                        padding: '6px 8px',
                        textAlign: 'right',
                        fontWeight: 600,
                        color: pnlColor(rt.realized_pnl),
                      }}>
                        {rt.realized_pnl >= 0 ? '+' : ''}{formatCurrency(rt.realized_pnl)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function StatBox({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div style={{
      padding: '10px 16px',
      background: 'var(--bg-secondary)',
      border: '1px solid var(--border)',
      borderRadius: 6,
      fontFamily: 'var(--font-mono)',
    }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        {label}
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, color: color ?? 'var(--text-primary)' }}>
        {value}
      </div>
    </div>
  );
}
