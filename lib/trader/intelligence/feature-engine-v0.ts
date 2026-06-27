import {
  BTC_USDT,
  featureReasonCodes,
  type Bar,
  type FeatureSnapshot,
  type Quote,
} from "@/lib/trader/intelligence/types";
import {
  compareDecimal,
  divideDecimal,
  formatDecimal,
  parseDecimal,
  subtractDecimal,
} from "@/lib/trader/risk/numeric";

const SMA_WINDOW = 20;
const ONE_MINUTE_MS = 60_000;
const STALE_QUOTE_MS = 120_000;
const MIN_QUALITY_SCORE = 0;
const MAX_QUALITY_SCORE = 1;

function mean(values: readonly string[]): string {
  if (values.length === 0) {
    throw new Error("[trader/intelligence] mean requires at least one value");
  }
  let sum = parseDecimal("0");
  for (const value of values) {
    sum += parseDecimal(value);
  }
  return formatDecimal(sum / BigInt(values.length));
}

function sampleStdDev(values: readonly string[], avg: string): string {
  if (values.length < 2) {
    return "0";
  }
  const avgScaled = parseDecimal(avg);
  let sumSq = 0n;
  for (const value of values) {
    const diff = parseDecimal(value) - avgScaled;
    sumSq += diff * diff;
  }
  const variance = sumSq / BigInt(values.length);
  const stdScaled = bigintSqrt(variance);
  return formatDecimal(stdScaled);
}

function bigintSqrt(value: bigint): bigint {
  if (value < 0n) {
    throw new Error("[trader/intelligence] sqrt of negative");
  }
  if (value < 2n) {
    return value;
  }
  let x0 = value;
  let x1 = (x0 + value / x0) >> 1n;
  while (x1 < x0) {
    x0 = x1;
    x1 = (x0 + value / x0) >> 1n;
  }
  return x0;
}

function countBarGaps(bars: readonly Bar[]): number {
  let gaps = 0;
  for (let index = 1; index < bars.length; index += 1) {
    const previousClose = Date.parse(bars[index - 1]!.barCloseTime);
    const currentOpen = Date.parse(bars[index]!.barOpenTime);
    if (currentOpen - previousClose > ONE_MINUTE_MS) {
      gaps += 1;
    }
  }
  return gaps;
}

function computeSpreadBps(quote: Quote | undefined): string {
  if (!quote) {
    return "0";
  }
  const mid = formatDecimal((parseDecimal(quote.bid) + parseDecimal(quote.ask)) / 2n);
  if (compareDecimal(mid, "0") === 0) {
    return "0";
  }
  const spread = subtractDecimal(quote.ask, quote.bid);
  const ratio = divideDecimal(spread, mid);
  return formatDecimal(parseDecimal(ratio) * 10_000n);
}

function computeDataQualityScore(
  bars: readonly Bar[],
  quote: Quote | undefined,
  evaluatedAtMs: number,
): { score: number; latestQuoteAgeMs?: number } {
  let score = MAX_QUALITY_SCORE;
  const gaps = countBarGaps(bars);
  if (gaps > 0) {
    score -= Math.min(0.4, gaps * 0.1);
  }
  if (bars.length < SMA_WINDOW) {
    score -= 0.5;
  }

  let latestQuoteAgeMs: number | undefined;
  if (quote) {
    latestQuoteAgeMs = Math.max(0, evaluatedAtMs - Date.parse(quote.timestamp));
    if (latestQuoteAgeMs > STALE_QUOTE_MS) {
      score -= 0.3;
    }
  } else {
    score -= 0.2;
  }

  return {
    score: Math.max(MIN_QUALITY_SCORE, Math.min(MAX_QUALITY_SCORE, score)),
    latestQuoteAgeMs,
  };
}

export type ComputeFeatureSnapshotInput = {
  bars: readonly Bar[];
  quote?: Quote;
  evaluatedAt?: string;
  newId?: () => string;
};

/**
 * Feature Engine v0 — computes features and owns {@link FeatureSnapshot.dataQualityScore}.
 */
export function computeFeatureSnapshot(input: ComputeFeatureSnapshotInput): FeatureSnapshot {
  const { bars, quote } = input;
  if (bars.length === 0) {
    throw new Error("[trader/intelligence] computeFeatureSnapshot requires at least one bar");
  }

  const instrumentId = bars[0]!.symbol;
  const evaluatedAt = input.evaluatedAt ?? bars[bars.length - 1]!.barCloseTime;
  const evaluatedAtMs = Date.parse(evaluatedAt);
  const window = bars.slice(-SMA_WINDOW);
  const closes = window.map((bar) => bar.close);
  const close = bars[bars.length - 1]!.close;
  const sma20 = closes.length > 0 ? mean(closes) : close;
  const realizedVol20 = sampleStdDev(closes, sma20);
  const stdForZ = sampleStdDev(closes, sma20);
  const zscoreVsSma20 =
    compareDecimal(stdForZ, "0") === 0
      ? "0"
      : divideDecimal(subtractDecimal(close, sma20), stdForZ);
  const spreadBps = computeSpreadBps(quote);
  const quality = computeDataQualityScore(bars, quote, evaluatedAtMs);

  return {
    featureSetId: (input.newId ?? crypto.randomUUID.bind(crypto))(),
    instrumentId,
    evaluatedAt,
    features: {
      close,
      sma20,
      zscoreVsSma20,
      realizedVol20,
      spreadBps,
    },
    dataQualityScore: quality.score,
    inputs: {
      barCount: bars.length,
      latestQuoteAgeMs: quality.latestQuoteAgeMs,
    },
  };
}

/** Exported for tests — quality gate threshold used by CDE v0. */
export const FEATURE_ENGINE_QUALITY_THRESHOLD = 0.5;

export function isInsufficientBars(bars: readonly Bar[]): boolean {
  return bars.length < SMA_WINDOW;
}

export function featureQualityReasonCodes(bars: readonly Bar[], quote?: Quote): string[] {
  const reasons: string[] = [];
  if (isInsufficientBars(bars)) {
    reasons.push(featureReasonCodes.insufficientBars);
  }
  if (countBarGaps(bars) > 0) {
    reasons.push(featureReasonCodes.barGapDetected);
  }
  if (quote) {
    const ageMs = Date.now() - Date.parse(quote.timestamp);
    if (ageMs > STALE_QUOTE_MS) {
      reasons.push(featureReasonCodes.staleQuote);
    }
  }
  return reasons;
}

export const DEFAULT_INSTRUMENT = BTC_USDT;
