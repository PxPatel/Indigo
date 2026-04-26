import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { api } from '../api/client';
import { CostBasisLadderChart } from './CostBasisLadderChart';
import { LadderStat } from './LadderStat';
import { LoadingShimmer } from './LoadingShimmer';
import { formatCurrency, formatPercent, pnlColor } from '../utils/format';
import { useLivePrices, priceRefreshInterval, priceRefreshStaleTime } from '../hooks/useLivePrices';

function TableSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {[1, 2, 3, 4].map((i) => (
        <div
          key={i}
          style={{
            height: 28,
            borderRadius: 4,
            background: 'var(--bg-tertiary)',
            opacity: 0.7,
          }}
        />
      ))}
    </div>
  );
}

export function CostBasisLadderModal({
  symbol,
  open,
  asOf,
  onClose,
  onExited,
}: {
  symbol: string | null;
  open: boolean;
  asOf?: string;
  onClose: () => void;
  onExited?: () => void;
}) {
  const [priceMode] = useLivePrices();
  const timeTravel = !!asOf;
  const { data, isLoading, isError } = useQuery({
    queryKey: ['cost-ladder', symbol, priceMode, asOf ?? null],
    queryFn: () => api.costBasisLadder(symbol!, priceMode, asOf),
    enabled: open && !!symbol,
    staleTime: timeTravel ? Infinity : priceRefreshStaleTime(priceMode),
    refetchInterval: timeTravel ? false : priceRefreshInterval(priceMode),
    refetchIntervalInBackground: true,
  });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence
      onExitComplete={() => {
        onExited?.();
      }}
    >
      {open && symbol && (
        <motion.div
          key="backdrop"
          role="presentation"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.2, ease: 'easeIn' } }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          onClick={onClose}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.55)',
            zIndex: 250,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <motion.div
            role="dialog"
            aria-modal
            aria-labelledby="cost-ladder-title"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{
              opacity: 0,
              y: 4,
              transition: { duration: 0.2, ease: 'easeIn' },
            }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              width: 'min(900px, calc(100vw - 32px))',
              maxHeight: 'min(90vh, 900px)',
              minHeight: 0,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              zIndex: 251,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                padding: '16px 20px',
                borderBottom: '1px solid var(--border)',
                gap: 16,
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  id="cost-ladder-title"
                  style={{
                    fontFamily: 'var(--font-heading)',
                    fontWeight: 700,
                    fontSize: 'clamp(16px, 4vw, 22px)',
                    color: 'var(--text-primary)',
                    letterSpacing: '-0.02em',
                    wordBreak: 'break-word',
                  }}
                >
                  {isLoading ? symbol : data?.symbol}
                  {data && (
                    <span
                      style={{
                        fontWeight: 400,
                        fontSize: 'clamp(12px, 2.5vw, 14px)',
                        color: 'var(--text-secondary)',
                        marginLeft: 8,
                        fontFamily: 'var(--font-body)',
                      }}
                    >
                      {data.name}
                    </span>
                  )}
                  {timeTravel && (
                    <span
                      style={{
                        marginLeft: 10,
                        padding: '2px 6px',
                        fontSize: 10,
                        fontWeight: 700,
                        fontFamily: 'var(--font-mono)',
                        letterSpacing: '0.5px',
                        textTransform: 'uppercase',
                        color: 'var(--accent-purple, #8b5cf6)',
                        background: 'rgba(139,92,246,0.15)',
                        border: '1px solid var(--accent-purple, #8b5cf6)',
                        borderRadius: 4,
                        verticalAlign: 'middle',
                      }}
                    >
                      As of {asOf}
                    </span>
                  )}
                </div>
                {!isLoading && data && (
                  <div
                    style={{
                      marginTop: 8,
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 12,
                      rowGap: 6,
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'clamp(11px, 2.5vw, 13px)',
                      minWidth: 0,
                    }}
                  >
                    <span style={{ color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                      ${data.current_price.toFixed(2)}
                    </span>
                    <span
                      style={{
                        color: pnlColor(data.today_change_dollars),
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {data.today_change_dollars >= 0 ? '' : '−'}
                      {formatCurrency(Math.abs(data.today_change_dollars))}{' '}
                      ({formatPercent(data.today_change_percent)})
                    </span>
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: 4,
                  display: 'flex',
                  flexShrink: 0,
                }}
              >
                <X size={20} />
              </button>
            </div>

            <div
              style={{
                padding: '12px 16px 16px',
                overflow: 'hidden',
                flex: 1,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              {isError && (
                <div style={{ color: 'var(--accent-red)', fontSize: 13 }}>
                  Could not load cost basis ladder.
                </div>
              )}
              {isLoading && (
                <>
                  <LoadingShimmer height={200} />
                  <TableSkeleton />
                </>
              )}
              {!isLoading && data && (
                <>
                  <p
                    style={{
                      fontSize: 11,
                      lineHeight: 1.45,
                      color: 'var(--text-secondary)',
                      fontFamily: 'var(--font-body)',
                      margin: 0,
                      flex: '0 0 auto',
                    }}
                  >
                    {data.ladder_intro}
                  </p>
                  <div style={{ flex: '0 0 auto', width: '100%', minHeight: 0 }}>
                    <CostBasisLadderChart
                      mergedLevels={data.merged_levels}
                      currentPrice={data.current_price}
                      compact={false}
                      modal
                    />
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 8,
                      flex: '0 0 auto',
                    }}
                  >
                    <LadderStat
                      label="Unrealized P&L ($)"
                      value={formatCurrency(data.unrealized_pnl_dollars)}
                      colorValue={data.unrealized_pnl_dollars}
                    />
                    <LadderStat
                      label="Unrealized P&L (%)"
                      value={formatPercent(data.unrealized_pnl_percent)}
                      colorValue={data.unrealized_pnl_percent}
                    />
                    <LadderStat
                      label="Avg days between buys"
                      value={
                        data.avg_days_between_buys != null
                          ? `${data.avg_days_between_buys.toFixed(1)} d`
                          : '—'
                      }
                    />
                    <LadderStat
                      label="Avg gap between lots"
                      value={
                        data.avg_interval_between_lot_prices != null
                          ? `$${data.avg_interval_between_lot_prices.toFixed(2)}`
                          : '—'
                      }
                    />
                    <LadderStat label="Open lots" value={String(data.open_lot_count)} />
                  </div>

                  <div
                    style={{
                      overflow: 'auto',
                      flex: '1 1 auto',
                      minHeight: 120,
                      WebkitOverflowScrolling: 'touch',
                    }}
                  >
                    <table
                      style={{
                        width: '100%',
                        borderCollapse: 'collapse',
                        fontSize: 11,
                        tableLayout: 'fixed',
                      }}
                    >
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border)' }}>
                          {['Date', 'Price', 'Shares', 'Current value', 'Lot P&L ($)', 'Lot P&L (%)'].map(
                            (h) => (
                              <th
                                key={h}
                                style={{
                                  textAlign: h === 'Date' ? 'left' : 'right',
                                  padding: '6px 8px',
                                  color: 'var(--text-muted)',
                                  fontWeight: 600,
                                  fontSize: 9,
                                  textTransform: 'uppercase',
                                  fontFamily: 'var(--font-body)',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                }}
                              >
                                {h}
                              </th>
                            ),
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {data.lots.map((row) => (
                          <tr
                            key={`${row.date}-${row.price}-${row.shares}`}
                            style={{ borderBottom: '1px solid var(--border)' }}
                          >
                            <td
                              style={{
                                padding: '6px 8px',
                                fontFamily: 'var(--font-body)',
                                color: 'var(--text-secondary)',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                              title={row.date}
                            >
                              {row.date}
                            </td>
                            <td
                              style={{
                                padding: '6px 8px',
                                textAlign: 'right',
                                fontFamily: 'var(--font-mono)',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              ${row.price.toFixed(2)}
                            </td>
                            <td
                              style={{
                                padding: '6px 8px',
                                textAlign: 'right',
                                fontFamily: 'var(--font-mono)',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              {row.shares.toFixed(4)}
                            </td>
                            <td
                              style={{
                                padding: '6px 8px',
                                textAlign: 'right',
                                fontFamily: 'var(--font-mono)',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              {formatCurrency(row.current_value)}
                            </td>
                            <td
                              style={{
                                padding: '6px 8px',
                                textAlign: 'right',
                                fontFamily: 'var(--font-mono)',
                                color: pnlColor(row.pnl_dollars),
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              {formatCurrency(row.pnl_dollars)}
                            </td>
                            <td
                              style={{
                                padding: '6px 8px',
                                textAlign: 'right',
                                fontFamily: 'var(--font-mono)',
                                color: pnlColor(row.pnl_percent),
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              {formatPercent(row.pnl_percent)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <p
                    style={{
                      fontSize: 10,
                      color: 'var(--text-muted)',
                      fontStyle: 'italic',
                      fontFamily: 'var(--font-body)',
                      marginTop: 4,
                    }}
                  >
                    {data.footnote}
                  </p>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
