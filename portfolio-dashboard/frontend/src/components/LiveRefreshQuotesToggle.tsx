import type { PriceRefreshMode } from '../api/client';

interface LiveRefreshQuotesToggleProps {
  mode: PriceRefreshMode;
  onChange: (next: PriceRefreshMode) => void;
}

/**
 * Segmented quote-refresh control — matches dark dashboard chrome (no native select).
 */
export function LiveRefreshQuotesToggle({ mode, onChange }: LiveRefreshQuotesToggleProps) {
  const options: { value: PriceRefreshMode; label: string; aria: string }[] = [
    { value: 'live', label: 'Live', aria: 'Live quote refresh' },
    { value: 'slow', label: 'Slow', aria: 'Slow quote refresh' },
    { value: 'off', label: 'No Update', aria: 'No quote updates' },
  ];

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <span
        style={{
          fontSize: 12,
          fontWeight: 500,
          color: 'var(--text-secondary)',
          fontFamily: 'var(--font-body)',
          letterSpacing: '0.02em',
          userSelect: 'none',
        }}
      >
        Quote updates
      </span>
      <div
        role="radiogroup"
        aria-label="Quote update mode"
        style={{
          display: 'inline-flex',
          padding: 3,
          borderRadius: 999,
          border: '1px solid var(--border-active)',
          background: 'var(--bg-tertiary)',
          boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.25)',
          flexShrink: 0,
        }}
      >
        {options.map((option) => {
          const selected = mode === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={option.aria}
              onClick={() => onChange(option.value)}
              style={{
                border: 0,
                borderRadius: 999,
                padding: '4px 10px',
                background: selected
                  ? 'linear-gradient(180deg, rgba(0, 220, 130, 0.24) 0%, rgba(0, 220, 130, 0.1) 100%)'
                  : 'transparent',
                color: selected ? 'var(--accent-green)' : 'var(--text-muted)',
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: 600,
                fontFamily: 'var(--font-body)',
                letterSpacing: '0.02em',
                transition: 'background 0.2s ease, color 0.2s ease',
              }}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
