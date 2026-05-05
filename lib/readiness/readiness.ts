import {
  ALLOWED_INDICATOR_PERCENTS,
  INDICATOR_KEYS_ORDER,
  type IndicatorKey,
  type IndicatorPercent,
  type IndicatorVector,
  type ReadinessInput,
  ReadinessValidationError,
  type ReadinessResult,
} from "@/lib/readiness/types";

const allowedSet = new Set<number>(ALLOWED_INDICATOR_PERCENTS);

function assertIndicator(orderIndex: number, value: unknown): IndicatorPercent {
  if (typeof value !== "number" || !allowedSet.has(value)) {
    throw new ReadinessValidationError(`Indicator at index ${orderIndex} is invalid`, [
      {
        path: `indicators[${orderIndex}]`,
        message: `Expected one of ${ALLOWED_INDICATOR_PERCENTS.join(", ")}, received ${JSON.stringify(value)}.`,
      },
    ]);
  }
  return value as IndicatorPercent;
}

/** Validates every coordinate and freezes the validated tuple runtime shape. */
export function parseIndicatorVector(values: Iterable<number>): IndicatorVector {
  const arr = [...values];
  if (arr.length !== 6) {
    throw new ReadinessValidationError("Indicator vectors must contain exactly six values", [
      { path: "indicators.length", message: `Expected 6 coordinates, received ${arr.length}` },
    ]);
  }
  return arr.map((v, i) => assertIndicator(i, v)) as unknown as IndicatorVector;
}

/** §7.1 formula */
export function computeTotalCompletionPercent(indicators: IndicatorVector): number {
  const sum = indicators.reduce<number>((acc, v) => acc + v, 0);
  return Math.floor(sum / 6);
}

function toScoresRecord(vector: IndicatorVector): Record<IndicatorKey, IndicatorPercent> {
  return INDICATOR_KEYS_ORDER.reduce(
    (acc, key, idx) => {
      acc[key] = vector[idx];
      return acc;
    },
    {} as Record<IndicatorKey, IndicatorPercent>,
  );
}

/**
 * Pure readiness derivation for a hydrated snapshot (`ReadinessInput`).
 * Persisting/updating snapshots from Twin dialogue or verification rows is upstream.
 */
export function computeReadinessResult(input: ReadinessInput): ReadinessResult {
  const indicators = parseIndicatorVector(input.indicators);

  const totalCompletionPercent = computeTotalCompletionPercent(indicators);
  const diaryTabUnlocked = totalCompletionPercent >= 60;
  const societyTabUnlocked = input.socializationCompleted;
  const readyForSocialization = totalCompletionPercent === 100 && !input.socializationCompleted;
  const showFinalTwinCompletionState =
    totalCompletionPercent === 100 &&
    input.socializationCompleted &&
    !input.finalStateMessageShown;

  return {
    indicators,
    totalCompletionPercent,
    scoresByIndicator: toScoresRecord(indicators),
    diaryTabUnlocked,
    societyTabUnlocked,
    readyForSocialization,
    showFinalTwinCompletionState,
  };
}
