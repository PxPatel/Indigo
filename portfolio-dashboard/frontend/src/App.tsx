import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from '@tanstack/react-query';
import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { usePortfolioStore } from './stores/portfolioStore';
import { useToastStore } from './components/Toaster';
import { UploadScreen } from './components/UploadScreen';
import { Sidebar } from './components/Sidebar';
import { ManualEntryModal } from './components/ManualEntryModal';
import { LoadingShimmer } from './components/LoadingShimmer';
import { Toaster } from './components/Toaster';
import { TopLoader } from './components/TopLoader';
import { LiveSpotBackgroundSync } from './components/LiveSpotBackgroundSync';
import { DebugScenarioPanel } from './components/DebugScenarioPanel';
import { api } from './api/client';

const Overview = lazy(() => import('./pages/Overview'));
const Holdings = lazy(() => import('./pages/Holdings'));
const CashFlow = lazy(() => import('./pages/CashFlow'));
const Risk = lazy(() => import('./pages/Risk'));
const Benchmark = lazy(() => import('./pages/Benchmark'));
const Simulator = lazy(() => import('./pages/Simulator'));
const Charts = lazy(() => import('./pages/Charts'));
const Transactions = lazy(() => import('./pages/Transactions'));
const BrokeragePickup = lazy(() => import('./pages/BrokeragePickup'));
const WebullCsvApiDiff = lazy(() => import('./pages/WebullCsvApiDiff'));

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      const msg = error instanceof Error ? error.message : 'An error occurred';
      useToastStore.getState().addToast({ type: 'error', message: msg });
    },
  }),
  mutationCache: new MutationCache({
    onError: (error) => {
      const msg = error instanceof Error ? error.message : 'An error occurred';
      useToastStore.getState().addToast({ type: 'error', message: msg });
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: 1,
    },
  },
});

/** Redirects to /import if no dataset is loaded. Runs synchronously — no flash. */
function RequireData({ children }: { children: React.ReactNode }) {
  const isUploaded = usePortfolioStore((s) => s.isUploaded);
  if (!isUploaded) return <Navigate to="/import" replace />;
  return <>{children}</>;
}

/** Redirects to / if a dataset is already loaded (avoids showing upload while on dashboard). */
function ImportRoute() {
  const isUploaded = usePortfolioStore((s) => s.isUploaded);
  if (isUploaded) return <Navigate to="/" replace />;
  return <UploadScreen />;
}

function DashboardLayout() {
  const { sidebarCollapsed } = usePortfolioStore();
  const reset = usePortfolioStore((s) => s.reset);

  const handleReupload = useCallback(() => {
    queryClient.clear();
    reset();
  }, [reset]);

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <LiveSpotBackgroundSync />
      <DebugScenarioPanel />
      <Sidebar onReupload={handleReupload} />
      <ManualEntryModal />
      <main style={{
        flex: 1,
        marginLeft: sidebarCollapsed ? 56 : 220,
        padding: 20,
        transition: 'margin-left 0.2s ease',
        minWidth: 0,
      }}>
        <Suspense fallback={<LoadingShimmer height={400} />}>
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/holdings" element={<Holdings />} />
            <Route path="/cashflow" element={<CashFlow />} />
            <Route path="/risk" element={<Risk />} />
            <Route path="/benchmark" element={<Benchmark />} />
            <Route path="/simulator" element={<Simulator />} />
            <Route path="/charts" element={<Charts />} />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/brokerage-pickup" element={<BrokeragePickup />} />
            <Route path="/webull-diff" element={<WebullCsvApiDiff />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}

export default function App() {
  const isUploaded = usePortfolioStore((s) => s.isUploaded);
  const reset = usePortfolioStore((s) => s.reset);

  // When localStorage says we're uploaded, verify the backend still has the data.
  // This covers the case where the backend restarted while the browser kept its state.
  // Skip the check entirely when not uploaded — go straight to the import screen.
  const [backendChecked, setBackendChecked] = useState(!isUploaded);

  useEffect(() => {
    if (!isUploaded) return;
    api.status()
      .then(({ has_data }) => { if (!has_data) reset(); })
      .catch(() => reset())
      .finally(() => setBackendChecked(true));
  }, [isUploaded, reset]);

  if (!backendChecked) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-primary)' }}>
        <LoadingShimmer height={320} />
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <TopLoader />
        <Toaster />
        <Routes>
          <Route path="/import" element={<ImportRoute />} />
          <Route
            path="/*"
            element={
              <RequireData>
                <DashboardLayout />
              </RequireData>
            }
          />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
