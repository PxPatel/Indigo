import { useState, useCallback } from 'react';

const KEY = 'valboard-live-prices';

/** Client `staleTime` / `refetchInterval` when live spots are on (matches backend spot cache ~60s). */
export const LIVE_SPOT_POLL_MS = 60_000;

/** Live quotes on (60s backend TTL) by default; persisted in localStorage. */
export function useLivePrices() {
  const [live, setLiveState] = useState(() => {
    if (typeof localStorage === 'undefined') return true;
    return localStorage.getItem(KEY) !== 'false';
  });
  const setLive = useCallback((v: boolean) => {
    localStorage.setItem(KEY, String(v));
    setLiveState(v);
  }, []);
  return [live, setLive] as const;
}
