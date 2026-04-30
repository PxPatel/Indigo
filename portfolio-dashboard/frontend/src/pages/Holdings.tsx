import { useQuery } from '@tanstack/react-query';
import { useState, useMemo, Fragment } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, ChevronDown, ChevronUp, ArrowUpDown, Clock, X, ChevronLeft, ChevronRight, History } from 'lucide-react';
import { api } from '../api/client';
import { Card } from '../components/Card';
import { LoadingShimmer } from '../components/LoadingShimmer';
import { TooltipWrap } from '../components/Tooltip';
import { formatCurrency, formatPercent, pnlColor } from '../utils/format';
import type { HoldingDetail } from '../api/client';
import { CostBasisLadderInline } from '../components/CostBasisLadderInline';
import { CostBasisLadderModal } from '../components/CostBasisLadderModal';
import { HoldingsLastSeenModal } from '../components/HoldingsLastSeenModal';
import { useLivePrices, priceRefreshInterval, priceRefreshStaleTime } from '../hooks/useLivePrices';
import { useHoldingsLastSeen } from '../hooks/useHoldingsLastSeen';
import { usePortfolioStore } from '../stores/portfolioStore';

type SortKey = keyof Pick<HoldingDetail, 'symbol' | 'shares' | 'avg_cost' | 'current_price' | 'market_value' | 'pnl_dollars' | 'pnl_percent' | 'weight' | 'today_change_dollars' | 'today_change_percent'>;

const todayIso = () => new Date().toISOString().slice(0, 10);

const addDaysIso = (iso: string, delta: number): string => {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
};

export default function Holdings() {
  const [priceMode] = useLivePrices();
  const portfolioSymbols = usePortfolioStore((s) => s.symbols);
  // Ephemeral time-travel state: plain useState so it resets on tab switch / reload.
  // Deliberately not in Zustand or localStorage.
  const [asOf, setAsOf] = useState<string | null>(null);
  const timeTravel = asOf !== null;

  const { data, isLoading } = useQuery({
    queryKey: ['holdings', priceMode, asOf],
    queryFn: () => api.holdings(priceMode, asOf ?? undefined),
    staleTime: timeTravel ? Infinity : priceRefreshStaleTime(priceMode),
    refetchInterval: timeTravel ? false : priceRefreshInterval(priceMode),
  });

  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('market_value');
  const [sortAsc, setSortAsc] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [ladderOpen, setLadderOpen] = useState<Record<string, boolean>>({});
  const [modalSymbol, setModalSymbol] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [lastSeenOpen, setLastSeenOpen] = useState(false);

  // Time-travel picker visibility + draft value (only applied on submit).
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draftDate, setDraftDate] = useState<string>('');

  const earliest = data?.earliest_date ?? undefined;
  const today = todayIso();

  const openPicker = () => {
    setDraftDate(asOf ?? today);
    setPickerOpen(true);
  };
  const closePicker = () => setPickerOpen(false);
  const applyDraft = () => {
    if (!draftDate) return;
    if (earliest && draftDate < earliest) return;
    if (draftDate > today) return;
    setAsOf(draftDate);
    // Intentionally keep the picker open so the user can iterate.
  };
  const clearAsOf = () => {
    setAsOf(null);
    setDraftDate(today);
  };

  // Step the applied as-of date by +/- days (for fast iteration). Uses the current
  // asOf if set, otherwise today; clamps to [earliest, today]. Backend handles
  // weekends/holidays by falling back to the most recent trading day.
  const effectiveDate = asOf ?? today;
  const canStepPrev = !!earliest && effectiveDate > earliest;
  const canStepNext = effectiveDate < today;
  const stepDays = (delta: number) => {
    const next = addDaysIso(effectiveDate, delta);
    const clamped = earliest && next < earliest
      ? earliest
      : next > today
        ? today
        : next;
    setAsOf(clamped);
    setDraftDate(clamped);
  };

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

  const {
    currentSnapshot,
    previousSnapshot,
    diff: lastSeenDiff,
    markCurrentAsSeen,
  } = useHoldingsLastSeen({
    data,
    priceMode,
    enabled: !timeTravel,
    portfolioSymbols,
  });

  if (isLoading) return <LoadingShimmer height={500} />;
  if (!data) return null;

  const priceLabel = timeTravel ? 'Close' : 'Price';
  const priceTip = timeTravel
    ? "Close price on the selected as-of date (or the most recent trading day before it). Options show \"\u2014\" (no historical OCC-symbol pricing)."
    : 'Latest market price from yfinance. Options show "\u2014" (live pricing unavailable).';
  const dayLabel = timeTravel ? 'Day Change' : 'Today';
  const dayPnlLabel = timeTravel ? 'Day P&L' : 'Today P&L';
  const dayTip = timeTravel
    ? "Close-to-close change ending on the as-of date. Flipped for short positions."
    : "Price change % from yesterday's close. Flipped for short positions.";
  const dayPnlTip = timeTravel
    ? "Nominal close-to-close P&L ending on the as-of date: shares × price change. Flipped for short positions."
    : "Nominal day P&L from yesterday's close to the latest price: shares × price change. Flipped for short positions.";
  const mvTip = timeTravel
    ? "Shares \u00d7 close on the as-of date. For options, shown at cost basis (no historical OCC pricing)."
    : "Shares \u00d7 current price. For options, shown at cost basis since live pricing is unavailable.";

  const cols: { key: SortKey; label: string; align?: 'right' | 'left'; tip: string }[] = [
    { key: 'symbol', label: 'Symbol', align: 'left', tip: 'Ticker symbol. Options show the full OCC symbol (underlying + expiry + strike).' },
    { key: 'shares', label: 'Shares', align: 'right', tip: 'Number of shares or contracts held. Negative indicates a short position.' },
    { key: 'avg_cost', label: 'Avg Cost', align: 'right', tip: 'Average cost per share using the average cost method, adjusted across all buys.' },
    { key: 'current_price', label: priceLabel, align: 'right', tip: priceTip },
    { key: 'market_value', label: 'Market Value', align: 'right', tip: mvTip },
    { key: 'pnl_dollars', label: 'P&L ($)', align: 'right', tip: 'Unrealized gain or loss: market value minus total cost basis.' },
    { key: 'pnl_percent', label: 'P&L (%)', align: 'right', tip: 'Unrealized return as a percentage: (market value \u00f7 cost basis) \u2212 1.' },
    { key: 'weight', label: 'Weight', align: 'right', tip: "This position's market value as a % of total portfolio value." },
    { key: 'today_change_dollars', label: dayPnlLabel, align: 'right', tip: dayPnlTip },
    { key: 'today_change_percent', label: dayLabel, align: 'right', tip: dayTip },
  ];

  return (
    <>
    <Card title="Holdings" index={0}>
      {/* Search + time-travel trigger */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        marginBottom: 16,
        flexWrap: 'wrap',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 12px',
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          flex: '1 1 300px',
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

        <TooltipWrap
          tip="Rewind to any past date to see positions as they stood. Uses historical close prices."
          style={{ marginLeft: 'auto' }}
        >
          <button
            type="button"
            onClick={() => (pickerOpen ? closePicker() : openPicker())}
            aria-expanded={pickerOpen}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 10px',
              background: timeTravel ? 'rgba(139,92,246,0.12)' : 'var(--bg-tertiary)',
              color: timeTravel ? 'var(--accent-purple, #8b5cf6)' : 'var(--text-secondary)',
              border: `1px solid ${timeTravel ? 'var(--accent-purple, #8b5cf6)' : 'var(--border)'}`,
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 12,
              fontFamily: 'var(--font-body)',
              fontWeight: 500,
            }}
          >
            <Clock size={13} />
            <span>{timeTravel ? `As of ${asOf}` : 'Time travel'}</span>
          </button>
        </TooltipWrap>

        <TooltipWrap
          tip={timeTravel
            ? 'Last-seen changes compare live holdings only. Exit time-travel mode to use it.'
            : 'Compare current holdings against the last saved viewing session.'}
        >
          <button
            type="button"
            onClick={() => setLastSeenOpen(true)}
            disabled={timeTravel}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 10px',
              background: 'var(--bg-tertiary)',
              color: timeTravel ? 'var(--text-muted)' : 'var(--text-secondary)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              cursor: timeTravel ? 'not-allowed' : 'pointer',
              fontSize: 12,
              fontFamily: 'var(--font-body)',
              fontWeight: 500,
              opacity: timeTravel ? 0.55 : 1,
            }}
          >
            <History size={13} />
            <span>Changes since last seen</span>
          </button>
        </TooltipWrap>
      </div>

      <AnimatePresence initial={false}>
        {pickerOpen && (
          <motion.div
            key="picker"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeInOut' }}
            style={{ overflow: 'hidden' }}
          >
            <form
              onSubmit={(e) => { e.preventDefault(); applyDraft(); }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
                padding: '10px 12px',
                marginBottom: 14,
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border)',
                borderRadius: 6,
              }}
            >
              <label
                htmlFor="holdings-asof-input"
                style={{
                  fontSize: 11,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  color: 'var(--text-muted)',
                  fontFamily: 'var(--font-body)',
                }}
              >
                As-of date
              </label>

              <div style={{ display: 'inline-flex', alignItems: 'stretch' }}>
                <button
                  type="button"
                  onClick={() => stepDays(-1)}
                  disabled={!canStepPrev}
                  aria-label="Previous day"
                  style={{
                    padding: '5px 8px',
                    background: 'var(--bg-primary)',
                    color: canStepPrev ? 'var(--text-primary)' : 'var(--text-muted)',
                    border: '1px solid var(--border)',
                    borderRight: 'none',
                    borderRadius: '6px 0 0 6px',
                    cursor: canStepPrev ? 'pointer' : 'not-allowed',
                    display: 'inline-flex',
                    alignItems: 'center',
                    opacity: canStepPrev ? 1 : 0.4,
                  }}
                >
                  <ChevronLeft size={14} />
                </button>
                <input
                  id="holdings-asof-input"
                  type="date"
                  value={draftDate}
                  min={earliest}
                  max={today}
                  onChange={(e) => setDraftDate(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') { e.preventDefault(); closePicker(); }
                  }}
                  autoFocus
                  style={{
                    background: 'var(--bg-primary)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border)',
                    borderRadius: 0,
                    padding: '5px 8px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 12,
                    outline: 'none',
                    colorScheme: 'dark',
                  }}
                />
                <button
                  type="button"
                  onClick={() => stepDays(1)}
                  disabled={!canStepNext}
                  aria-label="Next day"
                  style={{
                    padding: '5px 8px',
                    background: 'var(--bg-primary)',
                    color: canStepNext ? 'var(--text-primary)' : 'var(--text-muted)',
                    border: '1px solid var(--border)',
                    borderLeft: 'none',
                    borderRadius: '0 6px 6px 0',
                    cursor: canStepNext ? 'pointer' : 'not-allowed',
                    display: 'inline-flex',
                    alignItems: 'center',
                    opacity: canStepNext ? 1 : 0.4,
                  }}
                >
                  <ChevronRight size={14} />
                </button>
              </div>

              <button
                type="submit"
                disabled={!draftDate || (!!earliest && draftDate < earliest) || draftDate > today}
                style={{
                  padding: '5px 12px',
                  background: 'var(--accent-purple, #8b5cf6)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: 12,
                  fontFamily: 'var(--font-body)',
                  fontWeight: 600,
                  opacity: !draftDate || (!!earliest && draftDate < earliest) || draftDate > today ? 0.5 : 1,
                }}
              >
                Go
              </button>
              {timeTravel && (
                <button
                  type="button"
                  onClick={clearAsOf}
                  style={{
                    padding: '5px 10px',
                    background: 'transparent',
                    color: 'var(--text-muted)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontSize: 12,
                    fontFamily: 'var(--font-body)',
                  }}
                >
                  Return to today
                </button>
              )}
              <button
                type="button"
                onClick={closePicker}
                aria-label="Close picker"
                style={{
                  marginLeft: 'auto',
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: 2,
                  display: 'inline-flex',
                }}
              >
                <X size={14} />
              </button>
              <div
                style={{
                  flexBasis: '100%',
                  fontSize: 11,
                  color: 'var(--text-muted)',
                  fontFamily: 'var(--font-body)',
                }}
              >
                {earliest
                  ? `Pick any date between ${earliest} and today. Press Enter or Go to apply. Use \u2039 \u203a to step day by day.`
                  : 'Press Enter or Go to apply. Use \u2039 \u203a to step day by day.'}
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {timeTravel && (
        <div
          role="status"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 12px',
            marginBottom: 14,
            background: 'rgba(139, 92, 246, 0.08)',
            border: '1px solid var(--accent-purple, #8b5cf6)',
            borderRadius: 6,
            color: 'var(--text-primary)',
            fontSize: 12,
            fontFamily: 'var(--font-body)',
          }}
        >
          <Clock size={14} color="var(--accent-purple, #8b5cf6)" />
          <span style={{ flex: 1 }}>
            <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-purple, #8b5cf6)' }}>Time-travel mode</strong>
            {' \u2014 showing positions as of '}
            <strong style={{ fontFamily: 'var(--font-mono)' }}>{asOf}</strong>
            {'. Prices are historical closes; today\u2019s market is hidden.'}
          </span>
          <button
            type="button"
            onClick={clearAsOf}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: 2,
              display: 'inline-flex',
            }}
            aria-label="Exit time-travel mode"
          >
            <X size={14} />
          </button>
        </div>
      )}

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
                  <td style={{ padding: '8px 10px', textAlign: 'right', color: pnlColor(h.today_change_dollars) }}>
                    {formatCurrency(h.today_change_dollars)}
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', color: pnlColor(h.today_change_percent) }}>
                    {formatPercent(h.today_change_percent)}
                  </td>
                </tr>
                <AnimatePresence>
                  {expandedRow === h.symbol && (
                    <tr key={`${h.symbol}-detail`}>
                      <td colSpan={10} style={{ padding: 0 }}>
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
                                      asOf={asOf ?? undefined}
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
              <td style={{ padding: '10px 10px', textAlign: 'right', color: pnlColor(data.holdings.reduce((sum, h) => sum + h.today_change_dollars, 0)) }}>
                {formatCurrency(data.holdings.reduce((sum, h) => sum + h.today_change_dollars, 0))}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
    <CostBasisLadderModal
      symbol={modalSymbol}
      open={modalOpen}
      asOf={asOf ?? undefined}
      onClose={() => setModalOpen(false)}
      onExited={() => setModalSymbol(null)}
    />
    <HoldingsLastSeenModal
      open={lastSeenOpen}
      diff={lastSeenDiff}
      currentSnapshot={currentSnapshot}
      previousSnapshot={previousSnapshot}
      onClose={() => setLastSeenOpen(false)}
      onMarkSeen={markCurrentAsSeen}
    />
    </>
  );
}
