import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { useLivePrices, LIVE_SPOT_POLL_MS } from '../hooks/useLivePrices';
import type { AttributionResponse } from '../api/client';
import { Card } from './Card';
import { LoadingShimmer } from './LoadingShimmer';
import { pnlColor } from '../utils/format';

function sign(v: number): string {
  return v >= 0 ? '+' : '';
}

function fmt(v: number, decimals = 2): string {
  return `${sign(v)}${v.toFixed(decimals)}%`;
}

function ContributionBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(Math.abs(value) / max, 1) * 100 : 0;
  const color = value >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      flex: 1,
      minWidth: 60,
    }}>
      {value < 0 && (
        <div style={{
          height: 6,
          width: `${pct}%`,
          maxWidth: 80,
          background: color,
          borderRadius: 3,
          opacity: 0.7,
          marginLeft: 'auto',
        }} />
      )}
      {value >= 0 && (
        <div style={{
          height: 6,
          width: `${pct}%`,
          maxWidth: 80,
          background: color,
          borderRadius: 3,
          opacity: 0.7,
        }} />
      )}
    </div>
  );
}

function AttributionContent({ data }: { data: AttributionResponse }) {
  const { contributors, portfolio_return, cash_weight, top_sector, is_estimated, data_date } = data;

  const maxContrib = Math.max(...contributors.map(c => Math.abs(c.contribution)), 0.0001);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Header: total return + date context */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 24,
          fontWeight: 700,
          color: pnlColor(portfolio_return),
        }}>
          {fmt(portfolio_return)}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          as of {data_date}
        </span>
      </div>

      {/* Per-holding table */}
      <div style={{ overflowY: 'auto', maxHeight: 280 }}>
        <table style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: 12,
          fontFamily: 'var(--font-mono)',
        }}>
          <thead>
            <tr style={{ color: 'var(--text-muted)', fontSize: 10 }}>
              <th style={{ padding: '4px 6px', textAlign: 'left', fontWeight: 500 }}>Symbol</th>
              <th style={{ padding: '4px 6px', textAlign: 'right', fontWeight: 500 }}>Weight</th>
              <th style={{ padding: '4px 6px', textAlign: 'right', fontWeight: 500 }}>Return</th>
              <th style={{ padding: '4px 6px', textAlign: 'right', fontWeight: 500 }}>Contribution</th>
              <th style={{ padding: '4px 6px', width: 90 }} />
            </tr>
          </thead>
          <tbody>
            {contributors.map((c, i) => (
              <tr
                key={c.symbol}
                style={{ background: i % 2 === 0 ? 'var(--bg-secondary)' : 'var(--bg-tertiary)' }}
              >
                <td style={{ padding: '5px 6px', fontWeight: 600 }}>{c.symbol}</td>
                <td style={{ padding: '5px 6px', textAlign: 'right', color: 'var(--text-secondary)' }}>
                  {c.weight.toFixed(1)}%
                </td>
                <td style={{ padding: '5px 6px', textAlign: 'right', color: pnlColor(c.asset_return) }}>
                  {fmt(c.asset_return)}
                </td>
                <td style={{
                  padding: '5px 6px',
                  textAlign: 'right',
                  fontWeight: 600,
                  color: pnlColor(c.contribution),
                }}>
                  {fmt(c.contribution, 3)}
                </td>
                <td style={{ padding: '5px 6px' }}>
                  <ContributionBar value={c.contribution} max={maxContrib} />
                </td>
              </tr>
            ))}

            {/* Cash drag row — only if there's meaningful cash */}
            {cash_weight > 0.5 && (
              <tr style={{ background: 'var(--bg-secondary)', opacity: 0.7 }}>
                <td style={{ padding: '5px 6px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  Cash (uninvested)
                </td>
                <td style={{ padding: '5px 6px', textAlign: 'right', color: 'var(--text-muted)' }}>
                  {cash_weight.toFixed(1)}%
                </td>
                <td style={{ padding: '5px 6px', textAlign: 'right', color: 'var(--text-muted)' }}>
                  +0.00%
                </td>
                <td style={{ padding: '5px 6px', textAlign: 'right', color: 'var(--text-muted)' }}>
                  +0.000%
                </td>
                <td style={{ padding: '5px 6px' }} />
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Biggest sector driver */}
      {top_sector && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 10px',
          background: 'var(--bg-secondary)',
          borderRadius: 4,
          border: '1px solid var(--border)',
          fontSize: 12,
        }}>
          <span style={{ color: 'var(--text-muted)' }}>Biggest sector driver</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{top_sector.sector}</span>
          <span style={{
            fontFamily: 'var(--font-mono)',
            color: pnlColor(top_sector.contribution),
            marginLeft: 'auto',
          }}>
            {fmt(top_sector.contribution, 3)}
          </span>
        </div>
      )}
    </div>
  );
}

export function AttributionCard({ index, style }: { index: number; style?: React.CSSProperties }) {
  const [livePrices] = useLivePrices();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['attribution', livePrices],
    queryFn: () => api.attribution(livePrices),
    staleTime: livePrices ? LIVE_SPOT_POLL_MS : 5 * 60 * 1000,
    retry: 1,
  });

  return (
    <Card title="Attribution Breakdown" index={index} style={style}>
      {isLoading && <LoadingShimmer height={260} />}
      {isError && (
        <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '20px 0', textAlign: 'center' }}>
          Attribution unavailable — upload a portfolio to see today's breakdown.
        </div>
      )}
      {data && !isLoading && <AttributionContent data={data} />}
    </Card>
  );
}
