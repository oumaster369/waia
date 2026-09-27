import type { BarInterval } from "@/lib/trader/intelligence/types";
import { HTX_PERIOD_BY_INTERVAL } from "@/lib/trader/market-data/observation-types";

const PERIOD_SECONDS: Record<string, number> = {
  "1min": 60,
  "5min": 300,
  "15min": 900,
  "30min": 1800,
  "60min": 3600,
  "4hour": 14_400,
  "1day": 86_400,
};

export function htxPeriodToSeconds(period: string): number {
  const seconds = PERIOD_SECONDS[period];
  if (!seconds) {
    throw new Error(`[htx] unsupported kline period: ${period}`);
  }
  return seconds;
}

export function intervalDurationMs(interval: BarInterval): number {
  const period = HTX_PERIOD_BY_INTERVAL[interval];
  return htxPeriodToSeconds(period) * 1000;
}
