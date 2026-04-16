import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { TimeRangePreset } from '../utils/timeRange';
import { DEFAULT_CUSTOM_DAYS } from '../utils/timeRange';

interface PortfolioStore {
  isUploaded: boolean;
  isLoading: boolean;
  error: string | null;
  symbols: string[];
  selectedBenchmark: string;
  sidebarCollapsed: boolean;
  manualEntryCount: number;
  fundTransferCount: number;
  hasCashAnchor: boolean;
  manualEntryModalOpen: boolean;
  timeRangePreset: TimeRangePreset;
  customDays: number;
  setUploaded: (symbols: string[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setBenchmark: (ticker: string) => void;
  toggleSidebar: () => void;
  setManualEntryCount: (count: number) => void;
  setFundTransferCount: (count: number) => void;
  setHasCashAnchor: (has: boolean) => void;
  setManualEntryModalOpen: (open: boolean) => void;
  setTimeRangePreset: (preset: TimeRangePreset) => void;
  setCustomDays: (days: number) => void;
  reset: () => void;
}

export const usePortfolioStore = create<PortfolioStore>()(
  persist(
    (set) => ({
      isUploaded: false,
      isLoading: false,
      error: null,
      symbols: [],
      selectedBenchmark: 'SPY',
      sidebarCollapsed: false,
      manualEntryCount: 0,
      fundTransferCount: 0,
      hasCashAnchor: false,
      manualEntryModalOpen: false,
      timeRangePreset: 'YTD',
      customDays: DEFAULT_CUSTOM_DAYS,
      setUploaded: (symbols) => set({ isUploaded: true, symbols, error: null }),
      setLoading: (loading) => set({ isLoading: loading }),
      setError: (error) => set({ error }),
      setBenchmark: (ticker) => set({ selectedBenchmark: ticker }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setManualEntryCount: (count) => set({ manualEntryCount: count }),
      setFundTransferCount: (count) => set({ fundTransferCount: count }),
      setHasCashAnchor: (has) => set({ hasCashAnchor: has }),
      setManualEntryModalOpen: (open) => set({ manualEntryModalOpen: open }),
      setTimeRangePreset: (preset) => set({ timeRangePreset: preset }),
      setCustomDays: (days) => set({ customDays: Math.max(1, Math.floor(days) || 1) }),
      reset: () =>
        set({
          isUploaded: false,
          symbols: [],
          error: null,
          manualEntryCount: 0,
          fundTransferCount: 0,
          hasCashAnchor: false,
        }),
    }),
    {
      name: 'indigo-portfolio',
      // Only persist the upload state — everything else is derived from backend on load
      partialize: (state) => ({
        isUploaded: state.isUploaded,
        symbols: state.symbols,
        timeRangePreset: state.timeRangePreset,
        customDays: state.customDays,
      }),
    },
  ),
);
