import { motion } from 'framer-motion';
import { Info } from 'lucide-react';
import { useId, useState } from 'react';
import type { ReactNode } from 'react';

interface CardProps {
  title?: string;
  /** Shown in a hover tooltip next to the title (info icon). */
  titleInfo?: string;
  children: ReactNode;
  style?: React.CSSProperties;
  index?: number;
}

export function Card({ title, titleInfo, children, style, index = 0 }: CardProps) {
  const [infoOpen, setInfoOpen] = useState(false);
  const infoId = useId();

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.35 }}
      style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        padding: 16,
        ...style,
      }}
    >
      {title && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 12,
          }}
        >
          <div
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 12,
              fontFamily: 'var(--font-heading)',
              fontWeight: 600,
              color: 'var(--text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}
          >
            {title}
          </div>
          {titleInfo && (
            <span style={{ position: 'relative', flexShrink: 0, lineHeight: 0 }}>
              <button
                type="button"
                aria-describedby={infoOpen ? infoId : undefined}
                aria-label="How to interpret this chart"
                onMouseEnter={() => setInfoOpen(true)}
                onMouseLeave={() => setInfoOpen(false)}
                onFocus={() => setInfoOpen(true)}
                onBlur={() => setInfoOpen(false)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 2,
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--text-muted)',
                  cursor: 'help',
                  borderRadius: 999,
                }}
              >
                <Info size={15} strokeWidth={2} aria-hidden />
              </button>
              {infoOpen && (
                <div
                  id={infoId}
                  role="tooltip"
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 8px)',
                    right: 0,
                    zIndex: 200,
                    width: 'min(320px, 85vw)',
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border-active)',
                    borderRadius: 6,
                    padding: '10px 12px',
                    fontSize: 12,
                    fontFamily: 'var(--font-body)',
                    fontWeight: 400,
                    fontStyle: 'normal',
                    textTransform: 'none',
                    letterSpacing: 'normal',
                    lineHeight: 1.55,
                    color: 'var(--text-secondary)',
                    boxShadow: '0 6px 20px rgba(0,0,0,0.45)',
                    pointerEvents: 'none',
                  }}
                >
                  {titleInfo}
                </div>
              )}
            </span>
          )}
        </div>
      )}
      {children}
    </motion.div>
  );
}
