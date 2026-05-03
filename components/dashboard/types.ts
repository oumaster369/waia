/** Keys in readiness-model order §7 / dashboard shell §7.2. */
export type ModeId = "twin" | "diary" | "society";

export const INDICATOR_KEYS = [
  "Values",
  "Behavior",
  "Thinking",
  "Emotions",
  "Interests",
  "Goals",
] as const;
