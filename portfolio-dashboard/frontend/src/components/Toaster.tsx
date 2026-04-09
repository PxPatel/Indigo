import { create } from 'zustand';
import { AnimatePresence, motion } from 'framer-motion';
import { X, AlertCircle, CheckCircle, Info } from 'lucide-react';

type ToastType = 'error' | 'success' | 'info';

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastStore {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: number) => void;
}

let _nextId = 0;

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  addToast: ({ message, type }) => {
    const id = ++_nextId;
    // Keep at most 5 toasts visible at once
    set((s) => ({ toasts: [...s.toasts.slice(-4), { id, message, type }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 4500);
  },
  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

const ICON = { error: AlertCircle, success: CheckCircle, info: Info };
const STYLE: Record<ToastType, { bg: string; border: string; icon: string }> = {
  error:   { bg: 'rgba(255,71,87,0.12)',  border: 'rgba(255,71,87,0.35)',  icon: 'var(--accent-red)'   },
  success: { bg: 'rgba(0,220,130,0.12)',  border: 'rgba(0,220,130,0.35)', icon: 'var(--accent-green)' },
  info:    { bg: 'rgba(59,130,246,0.12)', border: 'rgba(59,130,246,0.35)',icon: 'var(--accent-blue)'  },
};

export function Toaster() {
  const { toasts, removeToast } = useToastStore();

  return (
    <div style={{
      position: 'fixed',
      bottom: 24,
      right: 24,
      zIndex: 9999,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      pointerEvents: 'none',
    }}>
      <AnimatePresence initial={false}>
        {toasts.map((t) => {
          const Icon = ICON[t.type];
          const s = STYLE[t.type];
          return (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 12, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.15 } }}
              transition={{ duration: 0.2 }}
              style={{
                pointerEvents: 'all',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                padding: '10px 12px 10px 14px',
                background: s.bg,
                border: `1px solid ${s.border}`,
                borderRadius: 6,
                maxWidth: 360,
                minWidth: 240,
              }}
            >
              <Icon size={14} color={s.icon} style={{ marginTop: 2, flexShrink: 0 }} />
              <span style={{
                flex: 1,
                fontSize: 13,
                fontFamily: 'var(--font-body)',
                color: 'var(--text-primary)',
                lineHeight: 1.45,
              }}>
                {t.message}
              </span>
              <button
                onClick={() => removeToast(t.id)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: 0,
                  display: 'flex',
                  flexShrink: 0,
                  marginTop: 1,
                }}
              >
                <X size={13} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
