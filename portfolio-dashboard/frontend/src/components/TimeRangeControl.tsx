import { usePortfolioStore } from '../stores/portfolioStore';
import { TIME_RANGE_PRESETS, type TimeRangePreset } from '../utils/timeRange';

const LABELS: Record<TimeRangePreset, string> = {
  YTD: 'YTD',
  '1M': '1M',
  '6M': '6M',
  '1Y': '1Y',
  ALL: 'All',
  CUSTOM: 'Custom',
};

export function TimeRangeControl() {
  const timeRangePreset = usePortfolioStore((s) => s.timeRangePreset);
  const customDays = usePortfolioStore((s) => s.customDays);
  const setTimeRangePreset = usePortfolioStore((s) => s.setTimeRangePreset);
  const setCustomDays = usePortfolioStore((s) => s.setCustomDays);

  return (
    <div
      role="radiogroup"
      aria-label="Time range"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          marginRight: 4,
        }}
      >
        Range
      </span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {TIME_RANGE_PRESETS.map((preset) => {
          const active = timeRangePreset === preset;
          return (
            <button
              key={preset}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setTimeRangePreset(preset)}
              style={{
                padding: '6px 10px',
                fontSize: 11,
                fontFamily: 'var(--font-mono)',
                fontWeight: 600,
                background: active ? 'var(--accent-blue)' : 'var(--bg-tertiary)',
                color: active ? '#fff' : 'var(--text-secondary)',
                border: `1px solid ${active ? 'var(--accent-blue)' : 'var(--border)'}`,
                borderRadius: 2,
                cursor: 'pointer',
                transition: 'background 0.15s ease, color 0.15s ease, border-color 0.15s ease',
                minWidth: 36,
              }}
            >
              {LABELS[preset]}
            </button>
          );
        })}
      </div>
      {timeRangePreset === 'CUSTOM' && (
        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 12,
            color: 'var(--text-secondary)',
            fontFamily: 'var(--font-body)',
          }}
        >
          <span>Last</span>
          <input
            type="number"
            min={1}
            step={1}
            value={customDays}
            onChange={(e) => setCustomDays(Number(e.target.value))}
            style={{
              width: 64,
              padding: '6px 8px',
              fontSize: 12,
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-primary)',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-active)',
              borderRadius: 2,
            }}
          />
          <span>days</span>
        </label>
      )}
    </div>
  );
}
