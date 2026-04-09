import { useQuery } from '@tanstack/react-query';
import { useState, useMemo } from 'react';
import { Search, ChevronDown, ChevronUp, ArrowUpDown } from 'lucide-react';
import { api } from '../api/client';
import { Card } from '../components/Card';
import { MetricCard } from '../components/MetricCard';
import { LoadingShimmer } from '../components/LoadingShimmer';
import { formatCurrency } from '../utils/format';
import type { TransactionRecord } from '../api/client';

type SortKey = 'date' | 'symbol' | 'quantity' | 'price' | 'total';

export default function Transactions() {
  const [filterSymbol, setFilterSymbol] = useState('');
  const [filterSide, setFilterSide] = useState<'' | 'BUY' | 'SELL'>('');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortAsc, setSortAsc] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['transactions'],
    queryFn: () => api.transactions(),
  });

  const filtered = useMemo(() => {
    if (!data) return [];
    let list = data.transactions;
    if (filterSide) list = list.filter((t) => t.side === filterSide);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((t) => t.symbol.toLowerCase().includes(q) || t.date.includes(q));
    }
    return [...list].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === 'string') return sortAsc ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [data, filterSide, search, sortKey, sortAsc]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  if (isLoading || !data) return <LoadingShimmer height={500} />;
  const { stats } = data;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Stats */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <MetricCard
          index={0}
          label="Total Transactions"
          value={stats.total_count.toString()}
          tooltip="Total number of filled buy and sell orders parsed from your uploaded CSV data."
        />
        <MetricCard
          index={1}
          label="Buys"
          value={stats.buy_count.toString()}
          tooltip="Number of buy orders across all your uploaded data."
        />
        <MetricCard
          index={2}
          label="Sells"
          value={stats.sell_count.toString()}
          tooltip="Number of sell orders across all your uploaded data."
        />
        <MetricCard
          index={3}
          label="Avg Buy Size"
          value={formatCurrency(stats.avg_buy_size)}
          tooltip="Average dollar amount per buy order."
        />
        <MetricCard
          index={4}
          label="Avg Sell Size"
          value={formatCurrency(stats.avg_sell_size)}
          tooltip="Average dollar amount per sell order."
        />
        <MetricCard
          index={5}
          label="Most Traded"
          value={stats.most_traded_symbol}
          tooltip="Symbol with the highest number of buy and sell orders combined."
        />
      </div>

      <Card title="Transaction Log" index={1}>
        {/* Filters */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 12px',
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            minWidth: 200,
          }}>
            <Search size={14} color="var(--text-muted)" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
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

          {/* Side filter */}
          <div style={{ display: 'flex', gap: 4 }}>
            {(['', 'BUY', 'SELL'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setFilterSide(s)}
                style={{
                  padding: '6px 12px',
                  fontSize: 11,
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 500,
                  background: filterSide === s ? 'var(--accent-blue)' : 'var(--bg-tertiary)',
                  color: filterSide === s ? '#fff' : 'var(--text-secondary)',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                {s || 'All'}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                {[
                  { key: 'date' as SortKey, label: 'Date', align: 'left' as const },
                  { key: 'symbol' as SortKey, label: 'Symbol', align: 'left' as const },
                  { key: 'side' as SortKey, label: 'Side', align: 'left' as const },
                  { key: 'quantity' as SortKey, label: 'Qty', align: 'right' as const },
                  { key: 'price' as SortKey, label: 'Price', align: 'right' as const },
                  { key: 'total' as SortKey, label: 'Total', align: 'right' as const },
                ].map((col) => (
                  <th
                    key={col.key}
                    onClick={() => handleSort(col.key)}
                    style={{
                      padding: '8px 10px',
                      textAlign: col.align,
                      color: 'var(--text-muted)',
                      fontSize: 10,
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      cursor: 'pointer',
                      userSelect: 'none',
                      borderBottom: '1px solid var(--border)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      {col.label}
                      {sortKey === col.key ? (
                        sortAsc ? <ChevronUp size={12} /> : <ChevronDown size={12} />
                      ) : (
                        <ArrowUpDown size={10} style={{ opacity: 0.3 }} />
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((t, i) => (
                <tr
                  key={i}
                  style={{
                    background: i % 2 === 0 ? 'var(--bg-secondary)' : 'var(--bg-tertiary)',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  <td style={{ padding: '7px 10px', color: 'var(--text-secondary)' }}>{t.date}</td>
                  <td style={{ padding: '7px 10px', fontWeight: 600 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      {t.symbol}
                      {t.instrument_type === 'option' && (
                        <span style={{
                          fontSize: 9, fontWeight: 700, padding: '1px 4px', borderRadius: 3,
                          background: 'rgba(139,92,246,0.2)', color: 'var(--accent-purple)',
                          letterSpacing: '0.5px',
                        }}>OPT</span>
                      )}
                    </span>
                  </td>
                  <td style={{ padding: '7px 10px' }}>
                    <span style={{
                      padding: '1px 6px',
                      borderRadius: 3,
                      fontSize: 10,
                      fontWeight: 600,
                      background: t.side === 'BUY' ? 'rgba(0,220,130,0.15)' : 'rgba(255,71,87,0.15)',
                      color: t.side === 'BUY' ? 'var(--accent-green)' : 'var(--accent-red)',
                    }}>
                      {t.side}
                    </span>
                  </td>
                  <td style={{ padding: '7px 10px', textAlign: 'right' }}>{t.quantity}</td>
                  <td style={{ padding: '7px 10px', textAlign: 'right' }}>${t.price.toFixed(2)}</td>
                  <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 500 }}>
                    {formatCurrency(t.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{
          marginTop: 12,
          fontSize: 11,
          color: 'var(--text-muted)',
          fontFamily: 'var(--font-mono)',
        }}>
          Showing {filtered.length} of {data.transactions.length} transactions
        </div>
      </Card>
    </div>
  );
}
