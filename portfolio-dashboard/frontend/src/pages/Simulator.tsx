import { useQuery } from '@tanstack/react-query';
import { useState, useEffect, useMemo, useRef } from 'react';
import { api, type SimulatorHolding } from '../api/client';
import { usePortfolioStore } from '../stores/portfolioStore';
import { LoadingShimmer } from '../components/LoadingShimmer';
import { TooltipWrap } from '../components/Tooltip';
import { formatCurrency, formatPercent, pnlColor } from '../utils/format';

const BENCHMARKS = ['SPY', 'QQQ', 'IWM', 'DIA'];

const METHODOLOGY_TIP =
  'Estimates portfolio impact by multiplying each position\'s market value by its 1-year beta and the simulated benchmark move. This is a linear approximation and does not account for correlation between holdings, volatility changes, or non-linear payoffs.';

function Badge({ label, variant }: { label: string; variant: 'opt' | 'nb' }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '1px 6px',
      borderRadius: 4,
      fontSize: 10,
      fontFamily: 'var(--font-mono)',
      fontWeight: 700,
      letterSpacing: '0.3px',
      background: variant === 'opt' ? 'rgba(255,71,87,0.15)' : 'rgba(120,120,140,0.2)',
      color: variant === 'opt' ? 'var(--accent-red)' : 'var(--text-muted)',
      border: `1px solid ${variant === 'opt' ? 'rgba(255,71,87,0.3)' : 'var(--border)'}`,
    }}>
      {label}
    </span>
  );
}

function SummaryCard({
  label,
  value,
  valueColor,
  tip,
}: {
  label: string;
  value: string;
  valueColor?: string;
  tip: string;
}) {
  return (
    <TooltipWrap tip={tip}>
      <div style={{
        flex: 1,
        minWidth: 140,
        padding: '12px 16px',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: 8,
      }}>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6, fontFamily: 'var(--font-body)' }}>
          {label}
        </div>
        <div style={{
          fontSize: 18,
          fontFamily: 'var(--font-mono)',
          fontWeight: 700,
          color: valueColor ?? 'var(--text-primary)',
        }}>
          {value}
        </div>
      </div>
    </TooltipWrap>
  );
}

export default function Simulator() {
  const { selectedBenchmark, setBenchmark } = usePortfolioStore();

  // shock is stored as a decimal (0.035 = +3.5%)
  const [shock, setShock] = useState(0);
  const [rangeMin, setRangeMin] = useState(-20);  // percent
  const [rangeMax, setRangeMax] = useState(20);   // percent

  // Editable endpoint state (strings while typing)
  const [minInput, setMinInput] = useState('-20');
  const [maxInput, setMaxInput] = useState('20');

  // Reset shock when benchmark changes
  const prevBenchmark = useRef(selectedBenchmark);
  useEffect(() => {
    if (selectedBenchmark !== prevBenchmark.current) {
      setShock(0);
      prevBenchmark.current = selectedBenchmark;
    }
  }, [selectedBenchmark]);

  const { data, isLoading } = useQuery({
    queryKey: ['simulator', selectedBenchmark],
    queryFn: () => api.simulator(selectedBenchmark),
  });

  const { included, optionsExcluded, noBetaExcluded, totalPortfolioMV } = useMemo(() => {
    if (!data) return { included: [], optionsExcluded: [], noBetaExcluded: [], totalPortfolioMV: 0 };

    const inc: SimulatorHolding[] = [];
    const opts: SimulatorHolding[] = [];
    const nob: SimulatorHolding[] = [];

    for (const h of data.holdings) {
      if (!h.excluded) {
        inc.push(h);
      } else if (h.exclusion_reason === 'option') {
        opts.push(h);
      } else {
        nob.push(h);
      }
    }

    return {
      included: inc,
      optionsExcluded: opts,
      noBetaExcluded: nob,
      totalPortfolioMV: data.total_market_value,
    };
  }, [data]);

  const simulatedPnlBySymbol = useMemo(() => {
    const map: Record<string, number> = {};
    for (const h of included) {
      map[h.symbol] = h.market_value * (h.beta_1yr ?? 0) * shock;
    }
    return map;
  }, [included, shock]);

  const totalSimulatedPnl = useMemo(
    () => Object.values(simulatedPnlBySymbol).reduce((a, b) => a + b, 0),
    [simulatedPnlBySymbol],
  );

  const totalSimulatedPct = totalPortfolioMV > 0
    ? (totalSimulatedPnl / totalPortfolioMV) * 100
    : 0;

  const sortedIncluded = useMemo(
    () => [...included].sort((a, b) => Math.abs(simulatedPnlBySymbol[b.symbol] ?? 0) - Math.abs(simulatedPnlBySymbol[a.symbol] ?? 0)),
    [included, simulatedPnlBySymbol],
  );

  function commitMinInput() {
    const raw = parseFloat(minInput);
    if (!isFinite(raw)) { setMinInput(String(rangeMin)); return; }
    const clamped = Math.max(-100, Math.min(0, raw));
    setRangeMin(clamped);
    setMinInput(String(clamped));
    // Clamp shock if now out of range
    setShock(prev => Math.max(clamped / 100, Math.min(rangeMax / 100, prev)));
  }

  function commitMaxInput() {
    const raw = parseFloat(maxInput);
    if (!isFinite(raw)) { setMaxInput(String(rangeMax)); return; }
    const clamped = Math.max(0, Math.min(100, raw));
    setRangeMax(clamped);
    setMaxInput(String(clamped));
    setShock(prev => Math.max(rangeMin / 100, Math.min(clamped / 100, prev)));
  }

  const shockPct = shock * 100;
  const shockDisplay = `${shockPct >= 0 ? '+' : ''}${shockPct.toFixed(1)}%`;

  if (isLoading || !data) return <LoadingShimmer height={600} />;

  const hasExcluded = optionsExcluded.length > 0 || noBetaExcluded.length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Summary Bar */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <TooltipWrap tip={METHODOLOGY_TIP}>
          <div style={{
            flex: 1,
            minWidth: 160,
            padding: '12px 16px',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 8,
          }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6, fontFamily: 'var(--font-body)' }}>
              Simulated Portfolio Δ ($)
            </div>
            <div style={{
              fontSize: 18,
              fontFamily: 'var(--font-mono)',
              fontWeight: 700,
              color: pnlColor(totalSimulatedPnl),
            }}>
              {totalSimulatedPnl >= 0 ? '+' : ''}{formatCurrency(totalSimulatedPnl)}
            </div>
          </div>
        </TooltipWrap>

        <TooltipWrap tip={METHODOLOGY_TIP}>
          <div style={{
            flex: 1,
            minWidth: 160,
            padding: '12px 16px',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 8,
          }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6, fontFamily: 'var(--font-body)' }}>
              Simulated Portfolio Δ (%)
            </div>
            <div style={{
              fontSize: 18,
              fontFamily: 'var(--font-mono)',
              fontWeight: 700,
              color: pnlColor(totalSimulatedPct),
            }}>
              {formatPercent(totalSimulatedPct)}
            </div>
          </div>
        </TooltipWrap>

        <SummaryCard
          label="Positions Included"
          value={String(included.length)}
          tip="Number of equity positions with a valid 1-year beta included in the simulation."
        />
        <SummaryCard
          label="Options Excluded"
          value={String(optionsExcluded.length)}
          tip="Options positions excluded because beta-based simulation does not apply to derivatives."
        />
        <SummaryCard
          label="No Beta Excluded"
          value={String(noBetaExcluded.length)}
          tip="Positions excluded because there is insufficient price history to compute a 1-year beta (< 60 trading days of data)."
        />
      </div>

      {/* Slider Section */}
      <div style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '24px 32px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 20,
      }}>
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
                background: selectedBenchmark === b ? 'var(--accent-blue)' : 'var(--bg-tertiary)',
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

        {/* Shock value display */}
        <div style={{
          fontSize: 36,
          fontFamily: 'var(--font-mono)',
          fontWeight: 700,
          color: shock > 0 ? 'var(--accent-green)' : shock < 0 ? 'var(--accent-red)' : 'var(--text-secondary)',
          letterSpacing: '-1px',
          minWidth: 120,
          textAlign: 'center',
        }}>
          {shockDisplay}
        </div>

        {/* Slider row with editable endpoints */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', maxWidth: 640 }}>
          {/* Min input */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <input
              type="number"
              value={minInput}
              onChange={(e) => setMinInput(e.target.value)}
              onBlur={commitMinInput}
              onKeyDown={(e) => { if (e.key === 'Enter') commitMinInput(); }}
              style={{
                width: 52,
                padding: '4px 6px',
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                color: 'var(--text-secondary)',
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                textAlign: 'center',
              }}
            />
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>%</span>
          </div>

          {/* Slider */}
          <input
            type="range"
            min={rangeMin}
            max={rangeMax}
            step={0.1}
            value={shockPct}
            onChange={(e) => setShock(parseFloat(e.target.value) / 100)}
            style={{
              flex: 1,
              accentColor: shock > 0 ? 'var(--accent-green)' : shock < 0 ? 'var(--accent-red)' : 'var(--accent-blue)',
              cursor: 'pointer',
              height: 4,
            }}
          />

          {/* Max input */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <input
              type="number"
              value={maxInput}
              onChange={(e) => setMaxInput(e.target.value)}
              onBlur={commitMaxInput}
              onKeyDown={(e) => { if (e.key === 'Enter') commitMaxInput(); }}
              style={{
                width: 52,
                padding: '4px 6px',
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                color: 'var(--text-secondary)',
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                textAlign: 'center',
              }}
            />
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>%</span>
          </div>
        </div>

        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-body)' }}>
          Drag to simulate a {selectedBenchmark} move. Edit endpoints to extend the range.
        </div>
      </div>

      {/* Breakdown Table */}
      <div style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        overflow: 'hidden',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-tertiary)' }}>
              {['Symbol', 'Baseline MV', 'Beta (1Y)', 'Baseline Price', 'Sim. Price', 'Simulated Δ ($)', 'Simulated Δ (%)'].map((h) => (
                <th key={h} style={{
                  padding: '10px 16px',
                  textAlign: h === 'Symbol' ? 'left' : 'right',
                  fontSize: 11,
                  fontFamily: 'var(--font-body)',
                  fontWeight: 500,
                  color: 'var(--text-muted)',
                  letterSpacing: '0.3px',
                  textTransform: 'uppercase',
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedIncluded.map((h) => {
              const pnl = simulatedPnlBySymbol[h.symbol] ?? 0;
              const pnlPct = h.market_value > 0 ? (pnl / h.market_value) * 100 : 0;
              return (
                <tr key={h.symbol} style={{ borderBottom: '1px solid var(--border)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-tertiary)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {h.symbol}
                  </td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                    {formatCurrency(h.market_value)}
                  </td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                    {h.beta_1yr?.toFixed(3) ?? '—'}
                  </td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                    {formatCurrency(h.current_price)}
                  </td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: shock !== 0 ? pnlColor(shock * (h.beta_1yr ?? 0)) : 'var(--text-secondary)' }}>
                    {formatCurrency(h.current_price * (1 + (h.beta_1yr ?? 0) * shock))}
                  </td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, color: pnlColor(pnl) }}>
                    {pnl >= 0 ? '+' : ''}{formatCurrency(pnl)}
                  </td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, color: pnlColor(pnlPct) }}>
                    {formatPercent(pnlPct)}
                  </td>
                </tr>
              );
            })}

            {/* Divider before excluded rows */}
            {hasExcluded && (
              <tr>
                <td colSpan={7} style={{
                  padding: '6px 16px',
                  background: 'var(--bg-tertiary)',
                  borderBottom: '1px solid var(--border)',
                  borderTop: '1px solid var(--border)',
                  fontSize: 10,
                  fontFamily: 'var(--font-body)',
                  color: 'var(--text-muted)',
                  letterSpacing: '0.5px',
                  textTransform: 'uppercase',
                }}>
                  Excluded positions
                </td>
              </tr>
            )}

            {[...optionsExcluded, ...noBetaExcluded].map((h) => (
              <tr key={h.symbol} style={{ borderBottom: '1px solid var(--border)', opacity: 0.5 }}>
                <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)' }}>
                  <span style={{ color: 'var(--text-secondary)', marginRight: 8 }}>{h.symbol}</span>
                  <Badge
                    label={h.exclusion_reason === 'option' ? 'OPT' : 'N/B'}
                    variant={h.exclusion_reason === 'option' ? 'opt' : 'nb'}
                  />
                </td>
                <td style={{ padding: '10px 16px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                  {formatCurrency(h.market_value)}
                </td>
                <td style={{ padding: '10px 16px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>—</td>
                <td style={{ padding: '10px 16px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>—</td>
                <td style={{ padding: '10px 16px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>—</td>
                <td style={{ padding: '10px 16px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>—</td>
                <td style={{ padding: '10px 16px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>—</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Footer footnote */}
        {hasExcluded && (
          <div style={{
            padding: '12px 16px',
            borderTop: '1px solid var(--border)',
            fontSize: 11,
            fontFamily: 'var(--font-body)',
            color: 'var(--text-muted)',
            lineHeight: 1.7,
          }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--accent-red)' }}>OPT</span>
            {' — Options positions are excluded; beta-based simulation does not apply to derivatives.'}
            <br />
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>N/B</span>
            {' — Insufficient price history to compute a 1-year beta.'}
          </div>
        )}
      </div>
    </div>
  );
}
