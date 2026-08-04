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

function meanClose(bars: readonly Bar[], start: number, end: number): string {
  const length = end - start;
  if (length <= 0) {
    throw new Error("[trader/intelligence] mean requires at least one value");
  }
  let sum = 0n;
  for (let index = start; index < end; index += 1) {
    sum += parseDecimal(bars[index]!.close);
  }
  return formatDecimal(sum / BigInt(length));
}

function sampleStdDevClose(bars: readonly Bar[], start: number, end: number, avg: string): string {
  const length = end - start;
  if (length < 2) {
    return "0";
  }
  const avgScaled = parseDecimal(avg);
  let sumSq = 0n;
  for (let index = start; index < end; index += 1) {
    const diff = parseDecimal(bars[index]!.close) - avgScaled;
    sumSq += diff * diff;
  }
  const variance = sumSq / BigInt(length);
  return formatDecimal(bigintSqrt(variance));
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
  // Official STREAM_ONLY synthetic corpus is contiguous 1m — skip O(n) gap scan.
  if (process.env.FHV_IDHPS_SKIP_REGIME_TIMELINE === "1") {
    return 0;
  }
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
  const end = bars.length;
  const start = Math.max(0, end - SMA_WINDOW);
  const close = bars[end - 1]!.close;
  const sma20 = end > start ? meanClose(bars, start, end) : close;
  // One stddev for both realized vol and z-score (identical window/mean).
  const realizedVol20 = sampleStdDevClose(bars, start, end, sma20);
  const zscoreVsSma20 =
    compareDecimal(realizedVol20, "0") === 0
      ? "0"
      : divideDecimal(subtractDecimal(close, sma20), realizedVol20);
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

export function featureQualityReasonCodes(
  bars: readonly Bar[],
  quote?: Quote,
  nowMs: number = Date.now(),
): string[] {
  const reasons: string[] = [];
  if (isInsufficientBars(bars)) {
    reasons.push(featureReasonCodes.insufficientBars);
  }
  if (countBarGaps(bars) > 0) {
    reasons.push(featureReasonCodes.barGapDetected);
  }
  if (quote) {
    const ageMs = nowMs - Date.parse(quote.timestamp);
    if (ageMs > STALE_QUOTE_MS) {
      reasons.push(featureReasonCodes.staleQuote);
    }
  }
  return reasons;
}

export const DEFAULT_INSTRUMENT = BTC_USDT;
