import { useCallback, useSyncExternalStore } from 'react';
import type { PriceRefreshMode } from '../api/client';

const KEY = 'valboard-live-prices';
const CHANGE_EVENT = 'valboard-live-prices-change';

/** Client `staleTime` / `refetchInterval` when live spots are on (matches backend spot cache ~60s). */
export const LIVE_SPOT_POLL_MS = 60_000;
export const SLOW_SPOT_POLL_MS = 5 * 60_000;

const MODES = new Set<PriceRefreshMode>(['live', 'slow', 'off']);

function readStoredMode(): PriceRefreshMode {
  if (typeof window === 'undefined') return 'live';
  const stored = window.localStorage.getItem(KEY);
  if (stored === 'false') return 'slow';
  if (stored === 'true' || stored == null) return 'live';
  return MODES.has(stored as PriceRefreshMode) ? (stored as PriceRefreshMode) : 'live';
}

function subscribeToModeChanges(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) onStoreChange();
  };

  window.addEventListener(CHANGE_EVENT, onStoreChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onStoreChange);
    window.removeEventListener('storage', onStorage);
  };
}

export function priceRefreshStaleTime(mode: PriceRefreshMode): number {
  if (mode === 'off') return Infinity;
  return mode === 'live' ? LIVE_SPOT_POLL_MS : SLOW_SPOT_POLL_MS;
}

export function priceRefreshInterval(mode: PriceRefreshMode): number | false {
  if (mode === 'off') return false;
  return priceRefreshStaleTime(mode);
}

/** Quote refresh mode persisted in localStorage. Defaults to live quotes. */
export function useLivePrices() {
  const mode = useSyncExternalStore<PriceRefreshMode>(subscribeToModeChanges, readStoredMode, () => 'live');
  const setMode = useCallback((v: PriceRefreshMode) => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(KEY, v);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);
  return [mode, setMode] as const;
}
