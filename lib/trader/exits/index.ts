export {
  EXIT_PLAN_SCHEMA_VERSION,
  DEFAULT_EXIT_RUN_CONFIG,
  type ExitPlan,
  type ExitRunConfig,
  type SlTpLevelsSnapshot,
  type StopLevel,
  type TakeProfitLevel,
  type TrailingPhase,
  type TrailingState,
} from "@/lib/trader/exits/exit-types";

export { exitReasonCodes, exitRuleIds } from "@/lib/trader/exits/exit-reason-codes";

export { computeAtrUsdt, filterBarsForLot, getCurrentBar } from "@/lib/trader/exits/atr-estimator";

export { computeSlTpLevels, type SlTpLevels } from "@/lib/trader/exits/sl-tp-calculator";

export {
  createInitialTrailingState,
  reduceTrailingState,
  type TrailingReducerInput,
  type TrailingReducerResult,
} from "@/lib/trader/exits/trailing-stop-machine";

export {
  buildExitPlan,
  createSlTpGuardianRuleProvider,
  toSlTpLevelsSnapshot,
  updateTrailingSessionState,
  type BuildExitPlanInput,
  type UpdateTrailingSessionInput,
} from "@/lib/trader/exits/exit-plan-builder";
