import { useState, useRef, useCallback, type ReactNode, type CSSProperties } from 'react';

const BUBBLE_STYLE: CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 8px)',
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 200,
  background: 'var(--bg-primary)',
  border: '1px solid var(--border-active)',
  borderRadius: 6,
  padding: '10px 14px',
  fontSize: 12,
  fontFamily: 'var(--font-body)',
  color: 'var(--text-secondary)',
  width: 300,
  lineHeight: 1.6,
  whiteSpace: 'normal',
  pointerEvents: 'none',
  boxShadow: '0 6px 20px rgba(0,0,0,0.4)',
};

interface TooltipWrapProps {
  tip: string;
  children: ReactNode;
  style?: CSSProperties;
}

/**
 * Wraps any element and shows a tooltip bubble after 1 second of hover.
 * The wrapper renders as a `position: relative` div — pass `style` to override
 * layout properties (e.g. `display: inline-flex`).
 */
export function TooltipWrap({ tip, children, style }: TooltipWrapProps) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onMouseEnter = useCallback(() => {
    timerRef.current = setTimeout(() => setVisible(true), 1000);
  }, []);
  const onMouseLeave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
  }, []);

  return (
    <div style={{ position: 'relative', ...style }} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
      {children}
      {visible && <div role="tooltip" style={BUBBLE_STYLE}>{tip}</div>}
    </div>
  );
}
