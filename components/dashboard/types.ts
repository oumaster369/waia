/** Keys in readiness-model order §7 / dashboard shell §7.2. */
export type ModeId = "twin" | "diary" | "society";

export type DashboardShellDemoSnapshot = {
  identityLabel: string;
  indicatorPercents: readonly [number, number, number, number, number, number];
  /** Stub total for display + lock rules until DEE-38 wires readiness service */
  totalCompletionPercent: number;
  hasMeaningfulExchange: boolean;
  socializationCompleted: boolean;
  finalStateMessageShown: boolean;
};

export const INDICATOR_KEYS = [
  "Values",
  "Behavior",
  "Thinking",
  "Emotions",
  "Interests",
  "Goals",
] as const;

export type IndicatorKey = (typeof INDICATOR_KEYS)[number];

/** New user row from dashboard shell §10 matrix (stub). */
export const DEFAULT_DEMO_SNAPSHOT = {
  identityLabel: "Dev user",
  indicatorPercents: [0, 0, 0, 0, 0, 0] as const,
  totalCompletionPercent: 0,
  hasMeaningfulExchange: false,
  socializationCompleted: false,
  finalStateMessageShown: false,
} satisfies DashboardShellDemoSnapshot;
