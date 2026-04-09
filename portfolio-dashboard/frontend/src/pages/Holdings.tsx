import { useQuery } from '@tanstack/react-query';
import { useState, useMemo, Fragment } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, ChevronDown, ChevronUp, ArrowUpDown } from 'lucide-react';
import { api } from '../api/client';
import { Card } from '../components/Card';
import { LoadingShimmer } from '../components/LoadingShimmer';
import { TooltipWrap } from '../components/Tooltip';
import { formatCurrency, formatPercent, pnlColor } from '../utils/format';
import type { HoldingDetail } from '../api/client';
import { CostBasisLadderInline } from '../components/CostBasisLadderInline';
import { CostBasisLadderModal } from '../components/CostBasisLadderModal';
import { useLivePrices, LIVE_SPOT_POLL_MS } from '../hooks/useLivePrices';

type SortKey = keyof Pick<HoldingDetail, 'symbol' | 'shares' | 'avg_cost' | 'current_price' | 'market_value' | 'pnl_dollars' | 'pnl_percent' | 'weight' | 'today_change_percent'>;

export default function Holdings() {
  const [livePrices] = useLivePrices();
  const { data, isLoading } = useQuery({
    queryKey: ['holdings', livePrices],
    queryFn: () => api.holdings(livePrices),
    staleTime: livePrices ? LIVE_SPOT_POLL_MS : undefined,
  });

  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('market_value');
  const [sortAsc, setSortAsc] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [ladderOpen, setLadderOpen] = useState<Record<string, boolean>>({});
  const [modalSymbol, setModalSymbol] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const filtered = useMemo(() => {
    if (!data) return [];
    let list = data.holdings;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((h) => h.symbol.toLowerCase().includes(q) || h.name.toLowerCase().includes(q));
    }
    list = [...list].sort((a, b) => {
      const av = a[sortKey] as number;
      const bv = b[sortKey] as number;
      return sortAsc ? av - bv : bv - av;
    });
    return list;
  }, [data, search, sortKey, sortAsc]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  const ladderEligible = (h: HoldingDetail) =>
    h.instrument_type !== 'option' && h.shares > 0;

  if (isLoading) return <LoadingShimmer height={500} />;
  if (!data) return null;

  const cols: { key: SortKey; label: string; align?: 'right' | 'left'; tip: string }[] = [
    { key: 'symbol', label: 'Symbol', align: 'left', tip: 'Ticker symbol. Options show the full OCC symbol (underlying + expiry + strike).' },
    { key: 'shares', label: 'Shares', align: 'right', tip: 'Number of shares or contracts held. Negative indicates a short position.' },
    { key: 'avg_cost', label: 'Avg Cost', align: 'right', tip: 'Average cost per share using the average cost method, adjusted across all buys.' },
    { key: 'current_price', label: 'Price', align: 'right', tip: 'Latest market price from yfinance. Options show "—" (live pricing unavailable).' },
    { key: 'market_value', label: 'Market Value', align: 'right', tip: 'Shares × current price. For options, shown at cost basis since live pricing is unavailable.' },
    { key: 'pnl_dollars', label: 'P&L ($)', align: 'right', tip: 'Unrealized gain or loss: market value minus total cost basis.' },
    { key: 'pnl_percent', label: 'P&L (%)', align: 'right', tip: 'Unrealized return as a percentage: (market value ÷ cost basis) − 1.' },
    { key: 'weight', label: 'Weight', align: 'right', tip: "This position's market value as a % of total portfolio value." },
    { key: 'today_change_percent', label: 'Today', align: 'right', tip: 'Price change % from yesterday\'s close. Flipped for short positions.' },
  ];

  return (
    <>
    <Card title="Holdings" index={0}>
      {/* Search */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginBottom: 16,
        padding: '6px 12px',
        background: 'var(--bg-tertiary)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        maxWidth: 300,
      }}>
        <Search size={14} color="var(--text-muted)" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search holdings..."
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-body)',
            fontSize: 13,
            outline: 'none',
            width: '100%',
          }}
        />
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              {cols.map((col) => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  style={{
                    padding: '8px 10px',
                    textAlign: col.align || 'left',
                    color: 'var(--text-muted)',
                    fontSize: 10,
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    cursor: 'pointer',
                    userSelect: 'none',
                    borderBottom: '1px solid var(--border)',
                    whiteSpace: 'nowrap',
                    position: 'relative',
                  }}
                >
                  <TooltipWrap tip={col.tip} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    {col.label}
                    {sortKey === col.key ? (
                      sortAsc ? <ChevronUp size={12} /> : <ChevronDown size={12} />
                    ) : (
                      <ArrowUpDown size={10} style={{ opacity: 0.3 }} />
                    )}
                  </TooltipWrap>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((h, i) => (
              <Fragment key={h.symbol}>
                <tr
                  onClick={() => {
                    setExpandedRow((prev) => (prev === h.symbol ? null : h.symbol));
                  }}
                  style={{
                    background: i % 2 === 0 ? 'var(--bg-secondary)' : 'var(--bg-tertiary)',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-mono)',
                    transition: 'background 0.1s ease',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-tertiary)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = i % 2 === 0 ? 'var(--bg-secondary)' : 'var(--bg-tertiary)')}
                >
                  <td style={{ padding: '8px 10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontWeight: 600 }}>{h.symbol}</span>
                      {h.instrument_type === 'option' && (
                        <span style={{
                          fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700,
                          padding: '1px 4px', borderRadius: 3,
                          background: 'rgba(139,92,246,0.2)', color: 'var(--accent-purple)',
                          letterSpacing: '0.5px',
                        }}>OPT</span>
                      )}
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-body)' }}>
                        {h.name.length > 20 ? h.name.slice(0, 20) + '...' : h.name}
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'right' }}>{h.shares.toFixed(2)}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right' }}>${h.avg_cost.toFixed(2)}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                    {h.instrument_type === 'option' ? '—' : `$${h.current_price.toFixed(2)}`}
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>
                    {formatCurrency(h.market_value)}
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', color: pnlColor(h.pnl_dollars) }}>
                    {formatCurrency(h.pnl_dollars)}
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', color: pnlColor(h.pnl_percent) }}>
                    {formatPercent(h.pnl_percent)}
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'right' }}>{h.weight.toFixed(1)}%</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', color: pnlColor(h.today_change_percent) }}>
                    {formatPercent(h.today_change_percent)}
                  </td>
                </tr>
                <AnimatePresence>
                  {expandedRow === h.symbol && (
                    <tr key={`${h.symbol}-detail`}>
                      <td colSpan={9} style={{ padding: 0 }}>
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.3, ease: 'easeInOut' }}
                          style={{
                            overflow: 'hidden',
                            background: 'var(--bg-primary)',
                            borderBottom: '1px solid var(--border)',
                          }}
                        >
                          <div style={{
                            padding: 16,
                            display: 'flex',
                            gap: 24,
                            flexWrap: 'wrap',
                            fontSize: 12,
                            fontFamily: 'var(--font-mono)',
                          }}>
                            <div>
                              <span style={{ color: 'var(--text-muted)' }}>Sector: </span>
                              <span>{h.sector}</span>
                            </div>
                            <div>
                              <span style={{ color: 'var(--text-muted)' }}>Cost Basis: </span>
                              <span>{formatCurrency(h.cost_basis)}</span>
                            </div>
                            <div>
                              <span style={{ color: 'var(--text-muted)' }}>Unrealized P&L: </span>
                              <span style={{ color: pnlColor(h.pnl_dollars) }}>
                                {formatCurrency(h.pnl_dollars)} ({formatPercent(h.pnl_percent)})
                              </span>
                            </div>
                            <div>
                              <span style={{ color: 'var(--text-muted)' }}>Last Activity: </span>
                              <span>{h.last_activity}</span>
                            </div>
                          </div>
                          {ladderEligible(h) && (
                            <div style={{ padding: '0 16px 12px' }}>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setLadderOpen((prev) => ({
                                    ...prev,
                                    [h.symbol]: !prev[h.symbol],
                                  }));
                                }}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  color: 'var(--text-muted)',
                                  cursor: 'pointer',
                                  fontSize: 12,
                                  fontFamily: 'var(--font-body)',
                                  padding: 0,
                                }}
                              >
                                {ladderOpen[h.symbol] ? 'Hide ladder ‹' : 'Show cost basis ladder ›'}
                              </button>
                              <AnimatePresence initial={false}>
                                {ladderOpen[h.symbol] && (
                                  <motion.div
                                    key="ladder"
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    transition={{ duration: 0.2, ease: 'easeInOut' }}
                                    style={{ overflow: 'hidden' }}
                                  >
                                    <CostBasisLadderInline
                                      symbol={h.symbol}
                                      enabled={expandedRow === h.symbol && !!ladderOpen[h.symbol]}
                                      onOpenDetail={() => {
                                        setModalSymbol(h.symbol);
                                        setModalOpen(true);
                                      }}
                                    />
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                          )}
                        </motion.div>
                      </td>
                    </tr>
                  )}
                </AnimatePresence>
              </Fragment>
            ))}
          </tbody>
          {/* Footer totals */}
          <tfoot>
            <tr style={{
              borderTop: '2px solid var(--border-active)',
              fontFamily: 'var(--font-mono)',
              fontWeight: 600,
              fontSize: 12,
            }}>
              <td style={{ padding: '10px 10px' }} colSpan={4}>Total</td>
              <td style={{ padding: '10px 10px', textAlign: 'right' }}>{formatCurrency(data.total_market_value)}</td>
              <td style={{ padding: '10px 10px', textAlign: 'right', color: pnlColor(data.total_pnl_dollars) }}>
                {formatCurrency(data.total_pnl_dollars)}
              </td>
              <td style={{ padding: '10px 10px', textAlign: 'right', color: pnlColor(data.total_pnl_percent) }}>
                {formatPercent(data.total_pnl_percent)}
              </td>
              <td style={{ padding: '10px 10px', textAlign: 'right' }}>100.0%</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
    <CostBasisLadderModal
      symbol={modalSymbol}
      open={modalOpen}
      onClose={() => setModalOpen(false)}
      onExited={() => setModalSymbol(null)}
    />
    </>
  );
}
