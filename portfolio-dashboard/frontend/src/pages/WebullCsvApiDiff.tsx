import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronRight, GitCompare, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { api, type WebullCsvApiDiffResponse, type WebullDiffStrategy, type WebullUniformFillRow } from '../api/client';
import { Card } from '../components/Card';
import { MetricCard } from '../components/MetricCard';
import { formatCurrency } from '../utils/format';

function CollapsibleSection({
  title,
  index,
  defaultOpen,
  count,
  children,
}: {
  title: string;
  index: number;
  defaultOpen: boolean;
  count?: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.35 }}
      style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        padding: 16,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
          textAlign: 'left',
        }}
      >
        <ChevronRight
          size={18}
          color="var(--text-muted)"
          style={{
            flexShrink: 0,
            transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 0.15s ease',
          }}
        />
        <span style={{
          fontSize: 12,
          fontFamily: 'var(--font-heading)',
          fontWeight: 600,
          color: 'var(--text-secondary)',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}
        >
          {title}
        </span>
        {count !== undefined && (
          <span style={{
            marginLeft: 'auto',
            fontSize: 12,
            fontFamily: 'var(--font-mono)',
            color: 'var(--text-muted)',
          }}
          >
            {count}
          </span>
        )}
      </button>
      {open ? <div style={{ marginTop: 12 }}>{children}</div> : null}
    </motion.div>
  );
}

function FillCell({ row }: { row: WebullUniformFillRow }) {
  return (
    <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', lineHeight: 1.45 }}>
      <div>
        <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{row.symbol}</span>
        {' '}
        <span style={{ color: row.side === 'BUY' ? 'var(--accent-green)' : 'var(--accent-red)' }}>{row.side}</span>
        {' '}
        {row.quantity} @ {row.price} → {formatCurrency(row.total_amount)}
      </div>
      <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>{row.filled_at_est}</div>
      <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{row.filled_at_utc}</div>
      {row.combo_type && (
        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>combo: {row.combo_type}</div>
      )}
      {row.client_order_id && (
        <div style={{ fontSize: 10, color: 'var(--text-muted)', wordBreak: 'break-all' }}>
          {row.client_order_id}
        </div>
      )}
    </div>
  );
}

const STRATEGIES: { value: WebullDiffStrategy; label: string }[] = [
  { value: 'from_csv_first', label: 'From first CSV trade → today' },
  { value: 'since_csv_last', label: 'Since last CSV trade → today' },
  { value: 'full_backfill', label: 'Full backfill (today backward until empty)' },
];

export default function WebullCsvApiDiff() {
  const [strategy, setStrategy] = useState<WebullDiffStrategy>('from_csv_first');
  const [accountId, setAccountId] = useState('');
  const [resultEpoch, setResultEpoch] = useState(0);

  const mutation = useMutation({
    mutationFn: () =>
      api.webullCsvApiDiff({
        strategy,
        account_id: accountId.trim() || undefined,
      }),
    onSuccess: () => setResultEpoch((n) => n + 1),
  });

  const data = mutation.data as WebullCsvApiDiffResponse | undefined;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <GitCompare size={22} color="var(--accent-blue)" />
        <h1 style={{
          fontFamily: 'var(--font-heading)',
          fontSize: 22,
          fontWeight: 700,
          color: 'var(--text-primary)',
          margin: 0,
        }}
        >
          CSV vs Webull API
        </h1>
      </div>
      <p style={{ color: 'var(--text-secondary)', fontSize: 13, maxWidth: 720, margin: 0 }}>
        Dev diff: loads order history from Webull (rate-limited, up to ~2 years per window) and matches rows to your
        uploaded CSV using symbol, side, qty, price, and fill time (±5s).         Set <code style={{ fontFamily: 'var(--font-mono)' }}>WEBULL_*</code> in{' '}
        <code style={{ fontFamily: 'var(--font-mono)' }}>portfolio-dashboard/backend/.env.local</code>
        {' '}(not the Vite frontend) and restart the API server.
      </p>

      <Card title="Run diff" index={0}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Strategy</span>
            <select
              value={strategy}
              onChange={(e) => setStrategy(e.target.value as WebullDiffStrategy)}
              style={{
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                color: 'var(--text-primary)',
                padding: '8px 12px',
                fontSize: 13,
                minWidth: 280,
              }}
            >
              {STRATEGIES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Account ID (optional if env set)</span>
            <input
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              placeholder="WEBULL_ACCOUNT_ID"
              style={{
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                color: 'var(--text-primary)',
                padding: '8px 12px',
                fontSize: 13,
                minWidth: 260,
                fontFamily: 'var(--font-mono)',
              }}
            />
          </label>
          <button
            type="button"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 18px',
              background: mutation.isPending ? 'var(--bg-tertiary)' : 'var(--accent-blue)',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: mutation.isPending ? 'not-allowed' : 'pointer',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {mutation.isPending ? (
              <Loader2 size={16} style={{ animation: 'spin 0.8s linear infinite' }} />
            ) : null}
            {mutation.isPending ? 'Fetching…' : 'Run diff'}
          </button>
        </div>
        {mutation.isError && (
          <div style={{ marginTop: 12, color: 'var(--accent-red)', fontSize: 13 }}>
            {mutation.error instanceof Error ? mutation.error.message : 'Request failed'}
          </div>
        )}
      </Card>

      {data && (
        <div key={resultEpoch} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {data.fetch_warnings && data.fetch_warnings.length > 0 && (
            <CollapsibleSection title="Fetch notes" index={0} defaultOpen count={data.fetch_warnings.length}>
              <div style={{
                padding: 12,
                borderRadius: 6,
                border: '1px solid var(--accent-amber)',
                background: 'rgba(245, 158, 11, 0.08)',
                fontSize: 12,
                color: 'var(--text-secondary)',
              }}
              >
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {data.fetch_warnings.map((w, i) => (
                    <li key={i} style={{ marginBottom: 6 }}>{w}</li>
                  ))}
                </ul>
              </div>
            </CollapsibleSection>
          )}
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>{data.time_note}</p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <MetricCard index={0} label="Matched pairs" value={data.matches.length.toString()} />
            <MetricCard index={1} label="CSV fills" value={data.csv_rows.length.toString()} />
            <MetricCard index={2} label="API fills" value={data.api_rows.length.toString()} />
            <MetricCard index={3} label="CSV only" value={data.unmatched_csv_indices.length.toString()} />
            <MetricCard index={4} label="API only" value={data.unmatched_api_indices.length.toString()} />
            <MetricCard index={5} label="API groups (raw)" value={data.api_group_count.toString()} />
          </div>
          <CollapsibleSection title="Fetch windows" index={1} defaultOpen={false}>
            <pre style={{
              margin: 0,
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-secondary)',
              overflow: 'auto',
            }}
            >
              {JSON.stringify(data.windows, null, 2)}
            </pre>
          </CollapsibleSection>

          <CollapsibleSection title="Matched rows" index={2} defaultOpen count={data.matches.length}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
                    <th style={{ padding: '8px 12px' }}>#</th>
                    <th style={{ padding: '8px 12px' }}>CSV</th>
                    <th style={{ padding: '8px 12px' }}>API</th>
                    <th style={{ padding: '8px 12px' }}>Δt ms</th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.matches].sort((a, b) => a.csv_row_index - b.csv_row_index).map((m, i) => (
                    <tr key={`${m.csv_row_index}-${m.api_row_index}`} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '12px', color: 'var(--text-muted)', verticalAlign: 'top' }}>{i + 1}</td>
                      <td style={{ padding: '12px', verticalAlign: 'top', background: 'rgba(0, 220, 130, 0.06)' }}>
                        <FillCell row={data.csv_rows[m.csv_row_index]} />
                      </td>
                      <td style={{ padding: '12px', verticalAlign: 'top', background: 'rgba(0, 220, 130, 0.06)' }}>
                        <FillCell row={data.api_rows[m.api_row_index]} />
                      </td>
                      <td style={{ padding: '12px', verticalAlign: 'top', fontFamily: 'var(--font-mono)' }}>
                        {m.time_delta_ms}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CollapsibleSection>

          <CollapsibleSection
            title="CSV only (no API match)"
            index={3}
            defaultOpen={false}
            count={data.unmatched_csv_indices.length}
          >
            {data.unmatched_csv_indices.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>None</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {data.unmatched_csv_indices.map((idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: 12,
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      background: 'var(--bg-tertiary)',
                    }}
                  >
                    <FillCell row={data.csv_rows[idx]} />
                  </div>
                ))}
              </div>
            )}
          </CollapsibleSection>

          <CollapsibleSection
            title="API only (no CSV match)"
            index={4}
            defaultOpen={false}
            count={data.unmatched_api_indices.length}
          >
            {data.unmatched_api_indices.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>None</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {data.unmatched_api_indices.map((idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: 12,
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      background: 'var(--bg-tertiary)',
                    }}
                  >
                    <FillCell row={data.api_rows[idx]} />
                  </div>
                ))}
              </div>
            )}
          </CollapsibleSection>
        </div>
      )}
    </div>
  );
}
