import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { useLivePrices, priceRefreshInterval, priceRefreshStaleTime } from '../hooks/useLivePrices';

/**
 * Subscribes to price-backed data while quote updates are enabled so refetch intervals
 * keep running even when navigating away from Overview or when the tab is in the
 * background (requires refetchIntervalInBackground).
 */
export function LiveSpotBackgroundSync() {
  const [priceMode] = useLivePrices();
  const refreshInterval = priceRefreshInterval(priceMode);
  const staleTime = priceRefreshStaleTime(priceMode);
  const enabled = refreshInterval !== false;

  useQuery({
    queryKey: ['summary', priceMode],
    queryFn: () => api.summary(priceMode),
    enabled,
    staleTime,
    refetchInterval: refreshInterval,
    refetchIntervalInBackground: true,
  });

  useQuery({
    queryKey: ['holdings', priceMode],
    queryFn: () => api.holdings(priceMode),
    enabled,
    staleTime,
    refetchInterval: refreshInterval,
    refetchIntervalInBackground: true,
  });

  useQuery({
    queryKey: ['attribution', priceMode],
    queryFn: () => api.attribution(priceMode),
    enabled,
    staleTime,
    refetchInterval: refreshInterval,
    refetchIntervalInBackground: true,
  });

  return null;
}
