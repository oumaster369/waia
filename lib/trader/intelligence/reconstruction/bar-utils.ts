import type { Bar, BarInterval } from "@/lib/trader/intelligence/types";
import { classifyBiasFromCloses } from "@/lib/trader/intelligence/reconstruction/reconstruction-kernel";
import { compareDecimal } from "@/lib/trader/risk/numeric";

export const STRUCTURE_TIMEFRAMES: readonly BarInterval[] = ["15m", "1h", "4h", "1d"];

export function sortBarsByCloseTime(bars: readonly Bar[]): Bar[] {
  return [...bars].sort((a, b) => a.barCloseTime.localeCompare(b.barCloseTime));
}

export function filterBarsByInterval(
  mtfBars: Partial<Record<BarInterval, Bar[]>>,
  interval: BarInterval,
): Bar[] {
  return sortBarsByCloseTime(mtfBars[interval] ?? []);
}

export function detectSwingPoints(
  bars: readonly Bar[],
  lookback = 2,
): {
  highs: { price: string; barCloseTime: string; kind: "HIGH" }[];
  lows: { price: string; barCloseTime: string; kind: "LOW" }[];
} {
  const highs: { price: string; barCloseTime: string; kind: "HIGH" }[] = [];
  const lows: { price: string; barCloseTime: string; kind: "LOW" }[] = [];

  if (bars.length < lookback * 2 + 1) {
    return { highs, lows };
  }

  for (let i = lookback; i < bars.length - lookback; i++) {
    const current = bars[i]!;
    let isHigh = true;
    let isLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) {
        continue;
      }
      if (compareDecimal(bars[j]!.high, current.high) > 0) {
        isHigh = false;
      }
      if (compareDecimal(bars[j]!.low, current.low) < 0) {
        isLow = false;
      }
    }
    if (isHigh) {
      highs.push({ price: current.high, barCloseTime: current.barCloseTime, kind: "HIGH" });
    }
    if (isLow) {
      lows.push({ price: current.low, barCloseTime: current.barCloseTime, kind: "LOW" });
    }
  }

  return { highs, lows };
}

export function clusterEqualLevels(
  prices: readonly string[],
  tolerancePct = 0.15,
): { price: string; touchCount: number }[] {
  if (prices.length === 0) {
    return [];
  }
  const clusters: { price: string; touchCount: number }[] = [];
  const sorted = [...prices].sort((a, b) => compareDecimal(a, b));

  let clusterPrice = sorted[0]!;
  let clusterCount = 1;

  for (let i = 1; i < sorted.length; i++) {
    const price = sorted[i]!;
    const base = Number(clusterPrice);
    const current = Number(price);
    if (!Number.isFinite(base) || base <= 0 || !Number.isFinite(current)) {
      continue;
    }
    const diffPct = (Math.abs(current - base) / base) * 100;
    if (diffPct <= tolerancePct) {
      clusterCount += 1;
    } else {
      if (clusterCount >= 2) {
        clusters.push({ price: clusterPrice, touchCount: clusterCount });
      }
      clusterPrice = price;
      clusterCount = 1;
    }
  }
  if (clusterCount >= 2) {
    clusters.push({ price: clusterPrice, touchCount: clusterCount });
  }

  return clusters;
}

export function computeRelativeVolume(bars: readonly Bar[], period = 20): string | null {
  if (bars.length < period + 1) {
    return null;
  }
  const recent = bars.slice(-period);
  const latest = bars.at(-1)!;
  const avg = recent.reduce((sum, bar) => sum + Number(bar.volume), 0) / Math.max(recent.length, 1);
  const latestVol = Number(latest.volume);
  if (!Number.isFinite(avg) || avg <= 0 || !Number.isFinite(latestVol)) {
    return null;
  }
  return (latestVol / avg).toFixed(4);
}

export function classifyEffortVsResult(
  bars: readonly Bar[],
): "IMPULSE" | "ABSORPTION" | "NEUTRAL" | "UNKNOWN" {
  if (bars.length < 3) {
    return "UNKNOWN";
  }
  const last = bars.at(-1)!;
  const prev = bars.at(-2)!;
  const range = Number(last.high) - Number(last.low);
  const body = Math.abs(Number(last.close) - Number(last.open));
  const volChange = Number(last.volume) - Number(prev.volume);
  if (!Number.isFinite(range) || range <= 0) {
    return "UNKNOWN";
  }
  const bodyRatio = body / range;
  if (bodyRatio > 0.6 && volChange > 0) {
    return "IMPULSE";
  }
  if (bodyRatio < 0.3 && volChange > 0) {
    return "ABSORPTION";
  }
  return "NEUTRAL";
}

export function classifyTimeframeBias(
  bars: readonly Bar[],
): "BULLISH" | "BEARISH" | "NEUTRAL" | "UNCLEAR" {
  if (bars.length < 3) {
    return "UNCLEAR";
  }
  return classifyBiasFromCloses(bars[0]!.close, bars.at(-1)!.close, bars.length);
}
