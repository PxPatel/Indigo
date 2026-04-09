import { pnlColor } from '../utils/format';

/** Compact metric tile for cost-basis ladder (inline + modal). */
export function LadderStat({
  label,
  value,
  colorValue,
}: {
  label: string;
  value: string;
  colorValue?: number;
}) {
  const color =
    colorValue !== undefined ? pnlColor(colorValue) : 'var(--text-primary)';
  return (
    <div
      style={{
        flex: '1 1 90px',
        minWidth: 0,
        maxWidth: 'min(168px, 100%)',
        padding: '6px 10px',
        border: '1px solid var(--border)',
        borderRadius: 6,
        background: 'var(--bg-tertiary)',
      }}
    >
      <div
        title={label}
        style={{
          fontSize: 9,
          fontFamily: 'var(--font-body)',
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.4px',
          marginBottom: 4,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </div>
      <div
        title={value}
        style={{
          fontSize: 13,
          fontFamily: 'var(--font-mono)',
          fontWeight: 600,
          color,
          lineHeight: 1.25,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </div>
    </div>
  );
}
