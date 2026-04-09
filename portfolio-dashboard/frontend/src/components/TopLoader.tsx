import { useIsFetching } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';

export function TopLoader() {
  const fetching = useIsFetching();

  return (
    <AnimatePresence>
      {fetching > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { delay: 0.25 } }}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            height: 2,
            zIndex: 10000,
            overflow: 'hidden',
            background: 'transparent',
          }}
        >
          <motion.div
            initial={{ x: '-100%' }}
            animate={{ x: '100%' }}
            transition={{ repeat: Infinity, duration: 1.1, ease: 'easeInOut' }}
            style={{
              position: 'absolute',
              inset: 0,
              width: '45%',
              background: 'var(--accent-blue)',
              borderRadius: 1,
            }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
