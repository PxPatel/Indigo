import { formatCurrency, formatPercent } from '../utils/format';

interface TooltipPayload {
  name: string;
  value: number;
  color: string;
  dataKey: string;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: TooltipPayload[];
  label?: string;
  valueFormat?: 'currency' | 'percent' | 'number';
}

export function ChartTooltip({ active, payload, label, valueFormat = 'currency' }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;

  const formatValue = (v: number) => {
    if (valueFormat === 'currency') return formatCurrency(v);
    if (valueFormat === 'percent') return formatPercent(v);
    return v.toFixed(2);
  };

  return (
    <div style={{
      background: 'var(--bg-tertiary)',
      border: '1px solid var(--border-active)',
      borderRadius: 4,
      padding: '8px 12px',
      fontSize: 12,
      fontFamily: 'var(--font-mono)',
    }}>
      <div style={{ color: 'var(--text-secondary)', marginBottom: 4, fontSize: 11 }}>
        {label}
      </div>
      {payload.map((entry, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
          <span style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: entry.color,
            flexShrink: 0,
          }} />
          <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>{entry.name}:</span>
          <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
            {formatValue(entry.value)}
          </span>
        </div>
      ))}
    </div>
  );
}
