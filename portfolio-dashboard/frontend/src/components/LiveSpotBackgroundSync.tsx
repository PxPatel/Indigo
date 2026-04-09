import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { useLivePrices, LIVE_SPOT_POLL_MS } from '../hooks/useLivePrices';

/**
 * Subscribes to summary, holdings, and attribution while live spots are on so refetch
 * intervals keep running even when navigating away from Overview or when the tab is in
 * the background (requires refetchIntervalInBackground).
 */
export function LiveSpotBackgroundSync() {
  const [livePrices] = useLivePrices();

  useQuery({
    queryKey: ['summary', livePrices],
    queryFn: () => api.summary(livePrices),
    enabled: livePrices,
    staleTime: LIVE_SPOT_POLL_MS,
    refetchInterval: LIVE_SPOT_POLL_MS,
    refetchIntervalInBackground: true,
  });

  useQuery({
    queryKey: ['holdings', livePrices],
    queryFn: () => api.holdings(livePrices),
    enabled: livePrices,
    staleTime: LIVE_SPOT_POLL_MS,
    refetchInterval: LIVE_SPOT_POLL_MS,
    refetchIntervalInBackground: true,
  });

  useQuery({
    queryKey: ['attribution', livePrices],
    queryFn: () => api.attribution(livePrices),
    enabled: livePrices,
    staleTime: LIVE_SPOT_POLL_MS,
    refetchInterval: LIVE_SPOT_POLL_MS,
    refetchIntervalInBackground: true,
  });

  return null;
}
