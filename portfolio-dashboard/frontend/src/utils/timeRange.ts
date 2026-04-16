import { format, startOfYear, subDays, subMonths, subYears } from 'date-fns';

export const TIME_RANGE_PRESETS = ['YTD', '1M', '6M', '1Y', 'ALL', 'CUSTOM'] as const;
export type TimeRangePreset = (typeof TIME_RANGE_PRESETS)[number];

export const DEFAULT_CUSTOM_DAYS = 30;

/** Resolve inclusive API bounds. ALL omits both ends (full dataset). */
export function getTimeRangeBounds(
  preset: TimeRangePreset,
  customDays: number,
  now: Date = new Date(),
): { from?: string; to?: string } {
  if (preset === 'ALL') {
    return {};
  }

  const to = format(now, 'yyyy-MM-dd');

  switch (preset) {
    case 'YTD':
      return { from: format(startOfYear(now), 'yyyy-MM-dd'), to };
    case '1M':
      return { from: format(subMonths(now, 1), 'yyyy-MM-dd'), to };
    case '6M':
      return { from: format(subMonths(now, 6), 'yyyy-MM-dd'), to };
    case '1Y':
      return { from: format(subYears(now, 1), 'yyyy-MM-dd'), to };
    case 'CUSTOM': {
      const days = Math.max(1, Math.floor(Number(customDays)) || 1);
      return { from: format(subDays(now, days), 'yyyy-MM-dd'), to };
    }
    default:
      return {};
  }
}
