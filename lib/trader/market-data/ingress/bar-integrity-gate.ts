import {
  detectGap,
  validateOhlcv,
  validateTimestamps,
} from "@/lib/trader/market-data/canvas/market-canvas";
import { computeBarSetDigest } from "@/lib/trader/market-data/research-dataset";
import { computeBarContentDigest } from "@/lib/trader/market-data/bar-content-digest";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import { compareDecimal } from "@/lib/trader/risk/numeric";
import type { Bar, BarInterval } from "@/lib/trader/intelligence/types";

export const INGRESS_INTEGRITY_REASON_CODES = [
  "HTR_WP12_INGRESS_IDENTITY_MISMATCH",
  "HTR_WP12_INGRESS_NON_MONOTONIC",
  "HTR_WP12_INGRESS_DUPLICATE",
  "HTR_WP12_INGRESS_INTERVAL_MISALIGNED",
  "HTR_WP12_INGRESS_NON_FINITE_OHLCV",
  "HTR_WP12_INGRESS_NEGATIVE_VOLUME",
  "HTR_WP12_INGRESS_INVALID_OHLC_RELATION",
  "HTR_WP12_INGRESS_MALFORMED_PROVENANCE",
  "HTR_WP12_INGRESS_DIGEST_MISMATCH",
] as const;

export type IngressIntegrityReasonCode = (typeof INGRESS_INTEGRITY_REASON_CODES)[number];

export type GapRecord = {
  fromBarOpenUtc: string;
  toBarOpenUtc: string;
  missingBarCount: number;
  durationMs: number;
};

export type IngressSourceProvenance = {
  sourceObjectId: string;
  retrieval: {
    retrievedAtUtc: string;
    method: string;
    uri?: string;
  };
  sourceChecksumSha256: string;
};

export type IngressIntegrityResults = {
  monotonic: boolean;
  duplicates: boolean;
  outOfOrder: boolean;
  nonFinite: boolean;
  negativeVolume: boolean;
  invalidRelation: boolean;
};

export type IngressIntegritySuccess = {
  ok: true;
  gaps: GapRecord[];
  integrityResults: IngressIntegrityResults;
  barSetDigest: string;
  normalizedContentDigest: string;
};

export type IngressIntegrityFailure = {
  ok: false;
  reason: IngressIntegrityReasonCode;
  detail: string;
  gaps: GapRecord[];
  integrityResults: IngressIntegrityResults;
};

export type IngressIntegrityResult = IngressIntegritySuccess | IngressIntegrityFailure;

export type AssertIngestBarsIntegrityInput = {
  bars: readonly Bar[];
  expectedSymbol: string;
  expectedInterval: BarInterval;
  intervalMs?: number;
  sourceProvenance?: readonly IngressSourceProvenance[];
  requireProvenance?: boolean;
  expectedBarSetDigest?: string;
  expectedNormalizedContentDigest?: string;
};

const INTERVAL_MS_BY_BAR_INTERVAL: Record<BarInterval, number> = {
  "1m": 60_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
};

function emptyIntegrityResults(): IngressIntegrityResults {
  return {
    monotonic: true,
    duplicates: false,
    outOfOrder: false,
    nonFinite: false,
    negativeVolume: false,
    invalidRelation: false,
  };
}

function fail(
  reason: IngressIntegrityReasonCode,
  detail: string,
  gaps: GapRecord[],
  integrityResults: IngressIntegrityResults,
): IngressIntegrityFailure {
  return { ok: false, reason, detail, gaps, integrityResults };
}

function isSha256Hex(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

function validateSourceProvenance(
  provenance: readonly IngressSourceProvenance[],
): IngressIntegrityReasonCode | null {
  if (provenance.length === 0) {
    return "HTR_WP12_INGRESS_MALFORMED_PROVENANCE";
  }

  for (const entry of provenance) {
    if (!entry.sourceObjectId.trim()) {
      return "HTR_WP12_INGRESS_MALFORMED_PROVENANCE";
    }
    if (!isSha256Hex(entry.sourceChecksumSha256)) {
      return "HTR_WP12_INGRESS_MALFORMED_PROVENANCE";
    }
    if (!entry.retrieval.method.trim()) {
      return "HTR_WP12_INGRESS_MALFORMED_PROVENANCE";
    }
    if (!Number.isFinite(Date.parse(entry.retrieval.retrievedAtUtc))) {
      return "HTR_WP12_INGRESS_MALFORMED_PROVENANCE";
    }
  }

  return null;
}

function hasNegativeVolume(bar: Bar): boolean {
  try {
    return compareDecimal(bar.volume, "0") < 0;
  } catch {
    return true;
  }
}

function hasNonFiniteOhlcv(bar: Bar): boolean {
  const fields = [bar.open, bar.high, bar.low, bar.close, bar.volume];
  for (const field of fields) {
    if (field === undefined || field === null || field === "") {
      return true;
    }
    const numeric = Number(field);
    if (!Number.isFinite(numeric)) {
      return true;
    }
  }
  return false;
}

function hasInvalidOhlcRelation(bar: Bar): boolean {
  if (validateTimestamps(bar) !== null) {
    return false;
  }
  if (hasNonFiniteOhlcv(bar)) {
    return false;
  }

  const ohlcvError = validateOhlcv(bar);
  if (ohlcvError !== null) {
    return true;
  }

  try {
    return (
      compareDecimal(bar.open, bar.low) < 0 ||
      compareDecimal(bar.open, bar.high) > 0 ||
      compareDecimal(bar.close, bar.low) < 0 ||
      compareDecimal(bar.close, bar.high) > 0
    );
  } catch {
    return true;
  }
}

function isIntervalAligned(bar: Bar, intervalMs: number): boolean {
  const openMs = Date.parse(bar.barOpenTime);
  const closeMs = Date.parse(bar.barCloseTime);
  if (!Number.isFinite(openMs) || !Number.isFinite(closeMs)) {
    return false;
  }
  if (openMs % intervalMs !== 0) {
    return false;
  }
  const durationMs = closeMs - openMs;
  return durationMs > 0 && durationMs <= intervalMs;
}

function recordGap(
  previousBarOpenMs: number,
  currentBarOpenMs: number,
  intervalMs: number,
): GapRecord {
  const fromBarOpenMs = previousBarOpenMs + intervalMs;
  const durationMs = currentBarOpenMs - fromBarOpenMs;
  return {
    fromBarOpenUtc: new Date(fromBarOpenMs).toISOString(),
    toBarOpenUtc: new Date(currentBarOpenMs).toISOString(),
    missingBarCount: Math.round(durationMs / intervalMs),
    durationMs,
  };
}

function computeNormalizedContentDigest(bars: readonly Bar[]): string {
  const barDigests = bars.map((bar) => computeBarContentDigest(bar));
  return computeStableJsonDigest({ barDigests });
}

/** Fail-closed pre-replay bar integrity gate (HTR-WP12). */
export function assertIngestBarsIntegrity(
  input: AssertIngestBarsIntegrityInput,
): IngressIntegrityResult {
  const { bars, expectedSymbol, expectedInterval } = input;
  const intervalMs = input.intervalMs ?? INTERVAL_MS_BY_BAR_INTERVAL[expectedInterval];
  const gaps: GapRecord[] = [];
  const integrityResults = emptyIntegrityResults();

  if (input.requireProvenance && input.sourceProvenance === undefined) {
    return fail(
      "HTR_WP12_INGRESS_MALFORMED_PROVENANCE",
      "source provenance required but absent",
      gaps,
      integrityResults,
    );
  }

  if (input.sourceProvenance !== undefined) {
    const provenanceError = validateSourceProvenance(input.sourceProvenance);
    if (provenanceError !== null) {
      return fail(provenanceError, "malformed ingress source provenance", gaps, integrityResults);
    }
  }

  if (bars.length === 0) {
    return fail(
      "HTR_WP12_INGRESS_IDENTITY_MISMATCH",
      "cannot validate integrity of empty bar history",
      gaps,
      integrityResults,
    );
  }

  const seenOpenTimes = new Set<string>();
  let previousOpenMs: number | null = null;

  for (const bar of bars) {
    if (bar.symbol !== expectedSymbol || bar.interval !== expectedInterval) {
      integrityResults.monotonic = false;
      return fail(
        "HTR_WP12_INGRESS_IDENTITY_MISMATCH",
        `expected ${expectedSymbol}/${expectedInterval}, got ${bar.symbol}/${bar.interval}`,
        gaps,
        integrityResults,
      );
    }

    if (validateTimestamps(bar) !== null) {
      integrityResults.nonFinite = true;
      return fail(
        "HTR_WP12_INGRESS_NON_FINITE_OHLCV",
        `invalid timestamps at ${bar.barOpenTime}`,
        gaps,
        integrityResults,
      );
    }

    if (!isIntervalAligned(bar, intervalMs)) {
      return fail(
        "HTR_WP12_INGRESS_INTERVAL_MISALIGNED",
        `interval misaligned at ${bar.barOpenTime}`,
        gaps,
        integrityResults,
      );
    }

    if (hasNonFiniteOhlcv(bar)) {
      integrityResults.nonFinite = true;
      return fail(
        "HTR_WP12_INGRESS_NON_FINITE_OHLCV",
        `non-finite OHLCV at ${bar.barOpenTime}`,
        gaps,
        integrityResults,
      );
    }

    if (hasNegativeVolume(bar)) {
      integrityResults.negativeVolume = true;
      return fail(
        "HTR_WP12_INGRESS_NEGATIVE_VOLUME",
        `negative volume at ${bar.barOpenTime}`,
        gaps,
        integrityResults,
      );
    }

    if (hasInvalidOhlcRelation(bar)) {
      integrityResults.invalidRelation = true;
      return fail(
        "HTR_WP12_INGRESS_INVALID_OHLC_RELATION",
        `invalid OHLC relation at ${bar.barOpenTime}`,
        gaps,
        integrityResults,
      );
    }

    if (seenOpenTimes.has(bar.barOpenTime)) {
      integrityResults.duplicates = true;
      return fail(
        "HTR_WP12_INGRESS_DUPLICATE",
        `duplicate barOpenTime ${bar.barOpenTime}`,
        gaps,
        integrityResults,
      );
    }
    seenOpenTimes.add(bar.barOpenTime);

    const barOpenMs = Date.parse(bar.barOpenTime);
    if (previousOpenMs !== null) {
      if (barOpenMs <= previousOpenMs) {
        integrityResults.outOfOrder = true;
        integrityResults.monotonic = false;
        return fail(
          "HTR_WP12_INGRESS_NON_MONOTONIC",
          `non-monotonic barOpenTime ${bar.barOpenTime}`,
          gaps,
          integrityResults,
        );
      }

      if (detectGap(previousOpenMs, barOpenMs)) {
        gaps.push(recordGap(previousOpenMs, barOpenMs, intervalMs));
      }
    }

    previousOpenMs = barOpenMs;
  }

  const barSetDigest = computeBarSetDigest(bars);
  const normalizedContentDigest = computeNormalizedContentDigest(bars);

  if (input.expectedBarSetDigest !== undefined && barSetDigest !== input.expectedBarSetDigest) {
    return fail(
      "HTR_WP12_INGRESS_DIGEST_MISMATCH",
      "bar set digest mismatch",
      gaps,
      integrityResults,
    );
  }

  if (
    input.expectedNormalizedContentDigest !== undefined &&
    normalizedContentDigest !== input.expectedNormalizedContentDigest
  ) {
    return fail(
      "HTR_WP12_INGRESS_DIGEST_MISMATCH",
      "normalized content digest mismatch",
      gaps,
      integrityResults,
    );
  }

  return {
    ok: true,
    gaps,
    integrityResults,
    barSetDigest,
    normalizedContentDigest,
  };
}

export function assertIngestBarsIntegrityOrThrow(
  input: AssertIngestBarsIntegrityInput,
): IngressIntegritySuccess {
  const result = assertIngestBarsIntegrity(input);
  if (!result.ok) {
    throw new Error(`[market-data] ${result.reason}: ${result.detail}`);
  }
  return result;
}
