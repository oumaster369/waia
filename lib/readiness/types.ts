/**
 * Canonical indicator order matches docs/product/ai-twin-readiness-model.md §9.
 */

export type IndicatorKey =
  | "values"
  | "behavior"
  | "thinking"
  | "emotions"
  | "interests"
  | "goals";

export const INDICATOR_KEYS_ORDER: readonly IndicatorKey[] = [
  "values",
  "behavior",
  "thinking",
  "emotions",
  "interests",
  "goals",
] as const;

export const ALLOWED_INDICATOR_PERCENTS = [0, 33, 67, 100] as const;

/** Storage-grade indicator percent per readiness model §6. */
export type IndicatorPercent = (typeof ALLOWED_INDICATOR_PERCENTS)[number];

/** Tuple (Values … Goals) strictly in INDICATOR_KEYS_ORDER. */
export type IndicatorVector = readonly [
  IndicatorPercent,
  IndicatorPercent,
  IndicatorPercent,
  IndicatorPercent,
  IndicatorPercent,
  IndicatorPercent,
];

export type ReadinessInput = {
  indicators: IndicatorVector;
  socializationCompleted: boolean;
  finalStateMessageShown: boolean;
};

/** Individual scores keyed for consumers that map by indicator name. */
export type ReadinessIndicatorsResult = {
  indicators: IndicatorVector;
  /** §7.1 `floor(sum / 6)` */
  totalCompletionPercent: number;
  scoresByIndicator: Record<IndicatorKey, IndicatorPercent>;
  diaryTabUnlocked: boolean;
  societyTabUnlocked: boolean;
  /** Twin-mode Socialization eligibility (user-flow ReadyForSocialization). */
  readyForSocialization: boolean;
};

export type LifecycleFlagsSlice = {
  /**
   * One-shot final twin completion UI after Socialization and before callers
   * persist finalStateMessageShown (user-flow §6 Step 10).
   */
  showFinalTwinCompletionState: boolean;
};

export type ReadinessResult = ReadinessIndicatorsResult & LifecycleFlagsSlice;

export type ReadinessValidationIssue = {
  path: string;
  message: string;
};

export class ReadinessValidationError extends Error {
  readonly issues: ReadonlyArray<ReadinessValidationIssue>;

  constructor(message: string, issues: ReadonlyArray<ReadinessValidationIssue>) {
    super(message);
    this.name = "ReadinessValidationError";
    this.issues = issues;
  }
}
