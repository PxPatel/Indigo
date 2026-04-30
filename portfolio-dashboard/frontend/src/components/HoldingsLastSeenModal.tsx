import { X } from 'lucide-react';
import { formatCurrency, pnlColor } from '../utils/format';
import type {
  HoldingsLastSeenDiff,
  HoldingsLastSeenSnapshot,
  LastSeenHoldingDiff,
} from '../utils/holdingsLastSeen';

interface HoldingsLastSeenModalProps {
  open: boolean;
  diff: HoldingsLastSeenDiff | null;
  currentSnapshot: HoldingsLastSeenSnapshot | null;
  previousSnapshot: HoldingsLastSeenSnapshot | null;
  onClose: () => void;
  onMarkSeen: () => void;
}

function fmtTime(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function statusLabel(row: LastSeenHoldingDiff): string {
  if (row.status === 'new') return 'New';
  if (row.status === 'closed') return 'Closed';
  if (row.status === 'shares_changed') return 'Shares changed';
  return 'Moved';
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div style={{
      padding: 12,
      borderRadius: 8,
      border: '1px solid var(--border)',
      background: 'var(--bg-secondary)',
    }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: pnlColor(value) }}>
        {formatCurrency(value)}
      </div>
    </div>
  );
}

function DeltaRow({ row }: { row: LastSeenHoldingDiff }) {
  const current = row.current;
  const previous = row.previous;
  return (
    <tr>
      <td style={{ padding: '7px 8px', fontWeight: 700, color: 'var(--text-primary)' }}>
        {row.symbol}
      </td>
      <td style={{ padding: '7px 8px', color: 'var(--text-muted)' }}>
        {statusLabel(row)}
      </td>
      <td style={{ padding: '7px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
        {(previous?.shares ?? 0).toFixed(2)} {'->'} {(current?.shares ?? 0).toFixed(2)}
      </td>
      <td style={{ padding: '7px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
        {formatCurrency(previous?.current_price ?? 0)} {'->'} {formatCurrency(current?.current_price ?? 0)}
      </td>
      <td style={{ padding: '7px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: pnlColor(row.deltas.market_value) }}>
        {formatCurrency(row.deltas.market_value)}
      </td>
      <td style={{ padding: '7px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: pnlColor(row.deltas.pnl_dollars) }}>
        {formatCurrency(row.deltas.pnl_dollars)}
      </td>
    </tr>
  );
}

export function HoldingsLastSeenModal({
  open,
  diff,
  currentSnapshot,
  previousSnapshot,
  onClose,
  onMarkSeen,
}: HoldingsLastSeenModalProps) {
  if (!open) return null;

  const titleDetail = previousSnapshot
    ? `Since ${fmtTime(previousSnapshot.savedAt)}`
    : 'No previous snapshot';
  const hasRows = diff !== null && diff.rows.length > 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Changes since last seen"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(0,0,0,0.62)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 'min(980px, 96vw)',
          maxHeight: '86vh',
          overflow: 'auto',
          borderRadius: 12,
          border: '1px solid var(--border-active)',
          background: 'var(--bg-primary)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 16,
          padding: '18px 20px',
          borderBottom: '1px solid var(--border)',
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, color: 'var(--text-primary)' }}>
              Changes since last seen
            </h2>
            <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-muted)' }}>
              {titleDetail}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close changes modal"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: 4,
              display: 'inline-flex',
            }}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: 20, display: 'grid', gap: 18 }}>
          {!previousSnapshot || !diff || !currentSnapshot ? (
            <div style={{
              padding: 18,
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--bg-secondary)',
              color: 'var(--text-secondary)',
              lineHeight: 1.5,
            }}>
              No previous comparable snapshot exists for this portfolio. Mark the current holdings as seen,
              then future visits will show what changed since that moment.
            </div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
                <SummaryCard label="Market value change" value={diff.totals.market_value} />
                <SummaryCard label="Open P&L change" value={diff.totals.pnl_dollars} />
                <SummaryCard label="Day P&L change" value={diff.totals.today_change_dollars} />
              </div>

              <section>
                <h3 style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--text-secondary)' }}>
                  Biggest movers
                </h3>
                {diff.biggestMovers.length === 0 ? (
                  <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>No position-level changes.</div>
                ) : (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {diff.biggestMovers.map((row) => (
                      <div key={row.symbol} style={{
                        padding: '8px 10px',
                        borderRadius: 8,
                        border: '1px solid var(--border)',
                        background: 'var(--bg-secondary)',
                        fontFamily: 'var(--font-mono)',
                      }}>
                        <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{row.symbol}</span>
                        <span style={{ marginLeft: 8, color: pnlColor(row.deltas.pnl_dollars) }}>
                          {formatCurrency(row.deltas.pnl_dollars)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {diff.positionChanges.length > 0 && (
                <section>
                  <h3 style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--text-secondary)' }}>
                    Position changes
                  </h3>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {diff.positionChanges.map((row) => (
                      <div key={row.symbol} style={{
                        padding: '6px 9px',
                        borderRadius: 999,
                        background: 'var(--bg-tertiary)',
                        border: '1px solid var(--border)',
                        fontSize: 12,
                      }}>
                        <strong style={{ fontFamily: 'var(--font-mono)' }}>{row.symbol}</strong>
                        <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>
                          {statusLabel(row)}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <section>
                <h3 style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--text-secondary)' }}>
                  All holdings
                </h3>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ color: 'var(--text-muted)', textTransform: 'uppercase', fontSize: 10 }}>
                        <th style={{ padding: '6px 8px', textAlign: 'left' }}>Symbol</th>
                        <th style={{ padding: '6px 8px', textAlign: 'left' }}>Status</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right' }}>Shares</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right' }}>Price</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right' }}>MV Delta</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right' }}>P&L Delta</th>
                      </tr>
                    </thead>
                    <tbody>
                      {hasRows ? diff.rows.map((row) => <DeltaRow key={row.symbol} row={row} />) : null}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}

          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            borderTop: '1px solid var(--border)',
            paddingTop: 14,
          }}>
            <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
              Snapshot updates when you leave the app after 30 seconds, or when you mark current as seen.
            </div>
            <button
              type="button"
              onClick={onMarkSeen}
              disabled={!currentSnapshot}
              style={{
                padding: '7px 12px',
                borderRadius: 6,
                border: '1px solid var(--accent-blue)',
                background: 'rgba(59,130,246,0.14)',
                color: 'var(--accent-blue)',
                fontFamily: 'var(--font-body)',
                fontSize: 12,
                fontWeight: 700,
                cursor: currentSnapshot ? 'pointer' : 'not-allowed',
                opacity: currentSnapshot ? 1 : 0.5,
              }}
            >
              Mark current as seen
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
