/**
 * Default readiness + Twin dialogue placeholder values used by dashboard-readiness-source (DEE-16)
 * until authenticated persistence (DEE-25) replaces the snapshot loader.
 * Input layer is not mixed with dialogue formulas here.
 */
import type { ReadinessInput } from "@/lib/readiness/types";

export const DEFAULT_READINESS_INPUT: ReadinessInput = {
  indicators: [0, 0, 0, 0, 0, 0],
  socializationCompleted: false,
  finalStateMessageShown: false,
};

export type TwinDialogueSignals = {
  /** Replaced by persistence in DEE-25 / follow-up. */
  hasMeaningfulExchange: boolean;
};

export const DEFAULT_TWIN_DIALOGUE_SIGNALS: TwinDialogueSignals = {
  hasMeaningfulExchange: false,
};

export const DEFAULT_DASHBOARD_IDENTITY_LABEL = "Dev user";
