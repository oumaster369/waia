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

export function classifyBiasFromCloses(
  firstClose: string,
  lastClose: string,
  closedCount: number,
): "BULLISH" | "BEARISH" | "NEUTRAL" | "UNCLEAR" {
  if (closedCount < 3) {
    return "UNCLEAR";
  }
  const first = Number(firstClose);
  const last = Number(lastClose);
  if (!Number.isFinite(first) || !Number.isFinite(last) || first <= 0) {
    return "UNCLEAR";
  }
  const changePct = ((last - first) / first) * 100;
  if (Math.abs(changePct) < 0.15) {
    return "NEUTRAL";
  }
  return changePct > 0 ? "BULLISH" : "BEARISH";
}

export function trueRange(current: Bar, previousClose: string): string {
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

export function seedAtrFromTrs(trs: readonly string[], period: number): string {
  let sum = 0n;
  for (let index = 0; index < period; index += 1) {
    sum += parseDecimal(trs[index]!);
  }
  return formatDecimal(sum / BigInt(period));
}

export function wilderNextAtr(prevAtr: string, tr: string, period: number): string {
  const weightedPrev = multiplyDecimal(prevAtr, String(period - 1));
  const numerator = formatDecimal(parseDecimal(weightedPrev) + parseDecimal(tr));
  return divideDecimal(numerator, String(period));
}

export function isHighSweepBar(levelPrice: string, bar: Bar): boolean {
  return compareDecimal(bar.high, levelPrice) > 0 && compareDecimal(bar.close, levelPrice) < 0;
}

export function isLowSweepBar(levelPrice: string, bar: Bar): boolean {
  return compareDecimal(bar.low, levelPrice) < 0 && compareDecimal(bar.close, levelPrice) > 0;
}

export function resolveLevelFormedAt(
  price: string,
  swings: readonly { price: string; barCloseTime: string }[],
  tolerancePct = 0.15,
): string {
  const matches = swings.filter((swing) => {
    const base = Number(price);
    const current = Number(swing.price);
    if (!Number.isFinite(base) || base <= 0 || !Number.isFinite(current)) {
      return false;
    }
    const diffPct = (Math.abs(current - base) / base) * 100;
    return diffPct <= tolerancePct;
  });
  if (matches.length === 0) {
    return "1970-01-01T00:00:00.000Z";
  }
  return matches.reduce(
    (latest, swing) => (swing.barCloseTime > latest ? swing.barCloseTime : latest),
    matches[0]!.barCloseTime,
  );
}
