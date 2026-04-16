interface LiveRefreshQuotesToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
}

/**
 * iOS-style switch for live spot polling — matches dark dashboard chrome (no native checkbox).
 */
export function LiveRefreshQuotesToggle({ checked, onChange }: LiveRefreshQuotesToggleProps) {
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
        Live refresh quotes
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={checked ? 'Live refresh quotes on' : 'Live refresh quotes off'}
        onClick={() => onChange(!checked)}
        style={{
          position: 'relative',
          width: 46,
          height: 26,
          borderRadius: 13,
          border: `1px solid ${checked ? 'rgba(0, 220, 130, 0.45)' : 'var(--border-active)'}`,
          background: checked
            ? 'linear-gradient(180deg, rgba(0, 220, 130, 0.22) 0%, rgba(0, 220, 130, 0.1) 100%)'
            : 'var(--bg-tertiary)',
          cursor: 'pointer',
          padding: 0,
          flexShrink: 0,
          transition: 'border-color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease',
          boxShadow: checked
            ? 'inset 0 1px 0 rgba(255,255,255,0.06)'
            : 'inset 0 1px 2px rgba(0,0,0,0.25)',
        }}
      >
        <span
          aria-hidden
          style={{
            position: 'absolute',
            top: 3,
            left: checked ? 23 : 3,
            width: 18,
            height: 18,
            borderRadius: '50%',
            background: checked
              ? 'linear-gradient(180deg, #1eff9a 0%, var(--accent-green) 100%)'
              : 'linear-gradient(180deg, var(--text-muted) 0%, #3a3a48 100%)',
            boxShadow: '0 1px 4px rgba(0,0,0,0.45)',
            transition: 'left 0.2s cubic-bezier(0.4, 0, 0.2, 1), background 0.2s ease',
          }}
        />
      </button>
    </div>
  );
}
