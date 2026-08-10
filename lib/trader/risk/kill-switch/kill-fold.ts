import type { KillSwitchEnforcementMode } from "@/lib/trader/risk/kill-switch/types";

/** Frozen kill-fold state machine (LD-8 / §1.22). */
export const KILL_FOLD_VERSION = "kill-fold/v1" as const;

export const KILL_FOLD_STAGES = [
  "TRIPPED",
  "REVOKE_EXPOSURE",
  "CANCEL_PENDING_ENTRIES",
  "CLOSE_ONLY",
  "FLATTEN",
  "RECONCILE",
  "HALT",
] as const;

export type KillFoldStage = (typeof KILL_FOLD_STAGES)[number];

export type KillFoldState = Readonly<{
  version: typeof KILL_FOLD_VERSION;
  stage: KillFoldStage;
  trippedAt: string;
  completedStages: readonly KillFoldStage[];
  haltActive: boolean;
  exposureRevoked: boolean;
  pendingEntriesCancelled: boolean;
  reconciled: boolean;
}>;

export type KillFoldAdvanceInput = Readonly<{
  pendingEntriesCancelled?: boolean;
  isFlat?: boolean;
  reconcileComplete?: boolean;
}>;

const STAGE_ORDINAL: Record<KillFoldStage, number> = {
  TRIPPED: 0,
  REVOKE_EXPOSURE: 1,
  CANCEL_PENDING_ENTRIES: 2,
  CLOSE_ONLY: 3,
  FLATTEN: 4,
  RECONCILE: 5,
  HALT: 6,
};

export function createKillFoldState(trippedAt: string): KillFoldState {
  return {
    version: KILL_FOLD_VERSION,
    stage: "TRIPPED",
    trippedAt,
    completedStages: ["TRIPPED"],
    haltActive: false,
    exposureRevoked: false,
    pendingEntriesCancelled: false,
    reconciled: false,
  };
}

function withCompletedStage(state: KillFoldState, stage: KillFoldStage): KillFoldState {
  const completedStages = state.completedStages.includes(stage)
    ? state.completedStages
    : [...state.completedStages, stage];
  return { ...state, stage, completedStages };
}

/** Deterministic single-step advance through the kill fold sequence. */
export function advanceKillFold(
  state: KillFoldState,
  input: KillFoldAdvanceInput = {},
): KillFoldState {
  if (state.haltActive) {
    return state;
  }

  switch (state.stage) {
    case "TRIPPED":
      return withCompletedStage({ ...state, exposureRevoked: true }, "REVOKE_EXPOSURE");
    case "REVOKE_EXPOSURE":
      return withCompletedStage(state, "CANCEL_PENDING_ENTRIES");
    case "CANCEL_PENDING_ENTRIES":
      return withCompletedStage(
        { ...state, pendingEntriesCancelled: input.pendingEntriesCancelled ?? true },
        "CLOSE_ONLY",
      );
    case "CLOSE_ONLY":
      return withCompletedStage(state, "FLATTEN");
    case "FLATTEN":
      if (!input.isFlat) {
        return state;
      }
      return withCompletedStage(state, "RECONCILE");
    case "RECONCILE":
      if (!input.reconcileComplete) {
        return state;
      }
      return withCompletedStage({ ...state, reconciled: true }, "HALT");
    case "HALT":
      return { ...state, haltActive: true };
    default: {
      const exhaustive: never = state.stage;
      return exhaustive;
    }
  }
}

/** Run the full kill fold to HALT when flat and reconciled. */
export function runKillFoldToHalt(
  trippedAt: string,
  input: { isFlat: boolean; reconcileComplete: boolean },
): KillFoldState {
  let state = createKillFoldState(trippedAt);
  const maxSteps = KILL_FOLD_STAGES.length * 2;
  for (let i = 0; i < maxSteps && !state.haltActive; i += 1) {
    const previousStage = state.stage;
    state = advanceKillFold(state, {
      pendingEntriesCancelled: true,
      isFlat: input.isFlat,
      reconcileComplete: input.reconcileComplete,
    });
    if (state.stage === "HALT" && !state.haltActive) {
      state = advanceKillFold(state);
    }
    if (state.stage === previousStage && state.stage !== "FLATTEN" && state.stage !== "RECONCILE") {
      break;
    }
    if (state.stage === previousStage) {
      break;
    }
  }
  if (state.stage === "HALT" && !state.haltActive) {
    state = advanceKillFold(state);
  }
  return state;
}

export function isKillFoldHaltActive(state: KillFoldState): boolean {
  return state.haltActive;
}

/** Maps kill-fold stage to risk enforcement mode for order gating. */
export function killFoldEnforcementModeForStage(stage: KillFoldStage): KillSwitchEnforcementMode {
  switch (stage) {
    case "TRIPPED":
    case "REVOKE_EXPOSURE":
    case "CANCEL_PENDING_ENTRIES":
      return "REJECT";
    case "CLOSE_ONLY":
    case "FLATTEN":
    case "RECONCILE":
      return "CLOSE_ONLY";
    case "HALT":
      return "STOP_ACCOUNT";
    default: {
      const exhaustive: never = stage;
      return exhaustive;
    }
  }
}

export function assertKillFoldStageOrdering(completedStages: readonly KillFoldStage[]): void {
  let maxOrdinal = -1;
  for (const stage of completedStages) {
    const ordinal = STAGE_ORDINAL[stage];
    if (ordinal <= maxOrdinal) {
      throw new Error(`kill fold stage ${stage} violates ordering`);
    }
    maxOrdinal = ordinal;
  }
}
