import type { Bar } from "@/lib/trader/intelligence/types";
import {
  absDecimal,
  compareDecimal,
  divideDecimal,
  formatDecimal,
  multiplyDecimal,
  parseDecimal,
  subtractDecimal,
} from "@/lib/trader/risk/numeric";

function trueRange(current: Bar, previousClose: string): string {
  const highLow = subtractDecimal(current.high, current.low);
  const highPrev = absDecimal(subtractDecimal(current.high, previousClose));
  const lowPrev = absDecimal(subtractDecimal(current.low, previousClose));

  let max = highLow;
  if (compareDecimal(highPrev, max) > 0) {
    max = highPrev;
  }
  if (compareDecimal(lowPrev, max) > 0) {
    max = lowPrev;
  }
  return max;
}

function sortBarsByCloseTime(bars: readonly Bar[]): Bar[] {
  return [...bars].sort((a, b) => {
    const timeCompare = a.barCloseTime.localeCompare(b.barCloseTime);
    if (timeCompare !== 0) {
      return timeCompare;
    }
    return a.symbol.localeCompare(b.symbol);
  });
}

/**
 * Collapse duplicate bars sharing the same (symbol, barCloseTime) key, keeping
 * the last occurrence in sorted order. Duplicate bars would otherwise double-count
 * true-range and corrupt the ATR deterministically-but-wrongly.
 */
function dedupBars(sorted: readonly Bar[]): Bar[] {
  const byKey = new Map<string, Bar>();
  for (const bar of sorted) {
    byKey.set(`${bar.symbol}|${bar.barCloseTime}`, bar);
  }
  return [...byKey.values()];
}

function isValidBar(bar: Bar): boolean {
  try {
    return (
      compareDecimal(bar.high, bar.low) >= 0 &&
      compareDecimal(bar.open, "0") > 0 &&
      compareDecimal(bar.close, "0") > 0 &&
      compareDecimal(bar.high, "0") > 0 &&
      compareDecimal(bar.low, "0") > 0
    );
  } catch {
    return false;
  }
}

/**
 * Wilder-style smoothed ATR over completed bars.
 * Returns null when bars are insufficient or OHLC is invalid.
 */
export function computeAtrUsdt(bars: readonly Bar[], period: number): string | null {
  if (period <= 0) {
    return null;
  }

  const sorted = dedupBars(sortBarsByCloseTime(bars));
  if (sorted.length < period) {
    return null;
  }

  for (const bar of sorted) {
    if (!isValidBar(bar)) {
      return null;
    }
  }

  try {
    const trueRanges: string[] = [];
    for (let index = 0; index < sorted.length; index += 1) {
      const bar = sorted[index]!;
      const previousClose = index === 0 ? bar.open : sorted[index - 1]!.close;
      trueRanges.push(trueRange(bar, previousClose));
    }

    let sum = 0n;
    for (let index = 0; index < period; index += 1) {
      sum += parseDecimal(trueRanges[index]!);
    }
    let atr = formatDecimal(sum / BigInt(period));

    for (let index = period; index < trueRanges.length; index += 1) {
      const weightedPrev = multiplyDecimal(atr, String(period - 1));
      const numerator = formatDecimal(
        parseDecimal(weightedPrev) + parseDecimal(trueRanges[index]!),
      );
      atr = divideDecimal(numerator, String(period));
    }

    if (compareDecimal(atr, "0") <= 0) {
      return null;
    }

    return atr;
  } catch {
    return null;
  }
}

export function filterBarsForLot(
  bars: readonly Bar[],
  symbol: string,
  openedAt: Date,
  evaluatedAt: string,
): Bar[] {
  const openMs = openedAt.getTime();
  const evalMs = new Date(evaluatedAt).getTime();
  return sortBarsByCloseTime(bars).filter((bar) => {
    if (bar.symbol !== symbol) {
      return false;
    }
    const closeMs = new Date(bar.barCloseTime).getTime();
    if (Number.isNaN(closeMs)) {
      return false;
    }
    if (!Number.isNaN(openMs) && closeMs < openMs) {
      return false;
    }
    if (!Number.isNaN(evalMs) && closeMs > evalMs) {
      return false;
    }
    return true;
  });
}

export function getCurrentBar(bars: readonly Bar[]): Bar | null {
  if (bars.length === 0) {
    return null;
  }
  const sorted = sortBarsByCloseTime(bars);
  return sorted[sorted.length - 1] ?? null;
}
