import { useState, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { pnlColor } from '../utils/format';

interface MetricCardProps {
  label: string;
  value: string;
  colorValue?: number;
  subtitle?: string;
  index?: number;
  tooltip?: string;
}

export function MetricCard({ label, value, colorValue, subtitle, index = 0, tooltip }: MetricCardProps) {
  const color = colorValue !== undefined ? pnlColor(colorValue) : 'var(--text-primary)';
  const [tipVisible, setTipVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onMouseEnter = useCallback(() => {
    if (!tooltip) return;
    timerRef.current = setTimeout(() => setTipVisible(true), 1000);
  }, [tooltip]);

  const onMouseLeave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setTipVisible(false);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.3 }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        position: 'relative',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        padding: '12px 16px',
        minWidth: 120,
        maxWidth: '100%',
        flex: 1,
        overflow: 'hidden',
      }}
    >
      <div style={{
        fontSize: 11,
        fontFamily: 'var(--font-body)',
        color: 'var(--text-secondary)',
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
        marginBottom: 4,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 20,
        fontFamily: 'var(--font-mono)',
        fontWeight: 600,
        color,
        lineHeight: 1.2,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        minWidth: 0,
      }}>
        {value}
      </div>
      {subtitle && (
        <div style={{
          fontSize: 11,
          fontFamily: 'var(--font-mono)',
          color: colorValue !== undefined ? color : 'var(--text-muted)',
          marginTop: 2,
        }}>
          {subtitle}
        </div>
      )}
      {tooltip && tipVisible && (
        <div
          role="tooltip"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 200,
            background: 'var(--bg-primary)',
            border: '1px solid var(--border-active)',
            borderRadius: 4,
            padding: '8px 12px',
            fontSize: 12,
            fontFamily: 'var(--font-body)',
            color: 'var(--text-secondary)',
            width: 300,
            lineHeight: 1.6,
            whiteSpace: 'normal',
            pointerEvents: 'none',
            boxShadow: '0 6px 20px rgba(0,0,0,0.4)',
          }}
        >
          {tooltip}
        </div>
      )}
    </motion.div>
  );
}
