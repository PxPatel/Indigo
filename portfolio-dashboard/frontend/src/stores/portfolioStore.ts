import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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
  setUploaded: (symbols: string[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setBenchmark: (ticker: string) => void;
  toggleSidebar: () => void;
  setManualEntryCount: (count: number) => void;
  setFundTransferCount: (count: number) => void;
  setHasCashAnchor: (has: boolean) => void;
  setManualEntryModalOpen: (open: boolean) => void;
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
      setUploaded: (symbols) => set({ isUploaded: true, symbols, error: null }),
      setLoading: (loading) => set({ isLoading: loading }),
      setError: (error) => set({ error }),
      setBenchmark: (ticker) => set({ selectedBenchmark: ticker }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setManualEntryCount: (count) => set({ manualEntryCount: count }),
      setFundTransferCount: (count) => set({ fundTransferCount: count }),
      setHasCashAnchor: (has) => set({ hasCashAnchor: has }),
      setManualEntryModalOpen: (open) => set({ manualEntryModalOpen: open }),
      reset: () => set({ isUploaded: false, symbols: [], error: null, manualEntryCount: 0, fundTransferCount: 0, hasCashAnchor: false }),
    }),
    {
      name: 'indigo-portfolio',
      // Only persist the upload state — everything else is derived from backend on load
      partialize: (state) => ({ isUploaded: state.isUploaded, symbols: state.symbols }),
    },
  ),
);
