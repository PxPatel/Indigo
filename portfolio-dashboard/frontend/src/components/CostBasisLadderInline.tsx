import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { useLivePrices, LIVE_SPOT_POLL_MS } from '../hooks/useLivePrices';
import { CostBasisLadderChart } from './CostBasisLadderChart';
import { LoadingShimmer } from './LoadingShimmer';
import { LadderStat } from './LadderStat';

export function CostBasisLadderInline({
  symbol,
  enabled,
  onOpenDetail,
}: {
  symbol: string;
  enabled: boolean;
  onOpenDetail: () => void;
}) {
  const [livePrices] = useLivePrices();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['cost-ladder', symbol, livePrices],
    queryFn: () => api.costBasisLadder(symbol, livePrices),
    enabled: enabled && !!symbol,
    staleTime: livePrices ? LIVE_SPOT_POLL_MS : undefined,
    refetchInterval: livePrices ? LIVE_SPOT_POLL_MS : false,
    refetchIntervalInBackground: true,
  });

  if (isError) {
    return (
      <div style={{ fontSize: 12, color: 'var(--accent-red)', paddingTop: 8 }}>
        Could not load ladder data.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div style={{ paddingTop: 8, maxWidth: 340, margin: '0 auto' }}>
        <LoadingShimmer height={140} />
      </div>
    );
  }

  if (!data) return null;

  return (
    <div style={{ paddingTop: 10, borderTop: '1px solid var(--border)' }}>
      <p
        style={{
          fontSize: 11,
          lineHeight: 1.45,
          color: 'var(--text-secondary)',
          fontFamily: 'var(--font-body)',
          marginBottom: 10,
          maxWidth: 520,
        }}
      >
        {data.ladder_intro}
      </p>
      <CostBasisLadderChart
        mergedLevels={data.merged_levels}
        currentPrice={data.current_price}
        compact
      />
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          marginTop: 12,
          justifyContent: 'flex-start',
        }}
      >
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
      </div>
      <p
        style={{
          fontSize: 10,
          color: 'var(--text-muted)',
          fontStyle: 'italic',
          fontFamily: 'var(--font-body)',
          marginTop: 10,
          lineHeight: 1.4,
          maxWidth: 520,
        }}
      >
        {data.footnote}
      </p>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenDetail();
          }}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--accent-blue)',
            cursor: 'pointer',
            fontSize: 12,
            fontFamily: 'var(--font-body)',
            padding: 4,
          }}
        >
          View in detail
        </button>
      </div>
    </div>
  );
}
