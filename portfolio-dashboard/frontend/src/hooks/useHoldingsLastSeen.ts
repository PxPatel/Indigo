import { useCallback, useEffect, useMemo, useState } from 'react';
import type { HoldingsResponse, PriceRefreshMode } from '../api/client';
import {
  buildHoldingsSnapshot,
  diffHoldingsSnapshot,
  loadHoldingsSnapshot,
  saveHoldingsSnapshot,
  type HoldingsLastSeenSnapshot,
} from '../utils/holdingsLastSeen';

const MIN_DWELL_MS = 30_000;

let sessionStartedAt = Date.now();
let latestSnapshotForSession: HoldingsLastSeenSnapshot | null = null;
let listenersInstalled = false;

function saveLatestForSession(force = false): boolean {
  if (!latestSnapshotForSession) return false;
  const dwelled = Date.now() - sessionStartedAt >= MIN_DWELL_MS;
  if (!force && !dwelled) return false;
  saveHoldingsSnapshot({
    ...latestSnapshotForSession,
    savedAt: new Date().toISOString(),
  });
  return true;
}

function installLastSeenListeners(): void {
  if (listenersInstalled || typeof window === 'undefined') return;
  listenersInstalled = true;
  sessionStartedAt = Date.now();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      saveLatestForSession(false);
    }
  });
  window.addEventListener('pagehide', () => {
    saveLatestForSession(false);
  });
}

interface UseHoldingsLastSeenOptions {
  data: HoldingsResponse | undefined;
  priceMode: PriceRefreshMode;
  enabled: boolean;
  portfolioSymbols?: string[];
}

export function useHoldingsLastSeen({
  data,
  priceMode,
  enabled,
  portfolioSymbols,
}: UseHoldingsLastSeenOptions) {
  const [manualVersion, setManualVersion] = useState(0);

  const currentSnapshot = useMemo(() => {
    if (!enabled || !data) return null;
    return buildHoldingsSnapshot(data, priceMode, new Date().toISOString(), portfolioSymbols);
  }, [data, enabled, portfolioSymbols, priceMode]);

  useEffect(() => {
    if (currentSnapshot) {
      latestSnapshotForSession = currentSnapshot;
    }
  }, [currentSnapshot]);

  const previousSnapshot = useMemo(() => {
    if (!currentSnapshot) return null;
    return loadHoldingsSnapshot(currentSnapshot.portfolioKey);
  }, [currentSnapshot, manualVersion]);

  const diff = useMemo(() => {
    if (!previousSnapshot || !currentSnapshot) return null;
    return diffHoldingsSnapshot(previousSnapshot, currentSnapshot);
  }, [currentSnapshot, previousSnapshot]);

  const saveLatest = useCallback((force = false) => {
    const saved = saveLatestForSession(force);
    if (saved) setManualVersion((v) => v + 1);
    return saved;
  }, []);

  useEffect(() => {
    if (enabled) installLastSeenListeners();
  }, [enabled]);

  return {
    currentSnapshot,
    previousSnapshot,
    diff,
    markCurrentAsSeen: () => saveLatest(true),
  };
}
