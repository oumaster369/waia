import type {
  StrategyLifecycleActor,
  StrategyLifecycleState,
  StrategyLifecycleTransition,
} from "@/lib/trader/intelligence/strategies/strategy-lifecycle.types";

export const strategyLifecycleReasonCodes = {
  notEligible: "STRAT_LIFECYCLE_NOT_ELIGIBLE",
  invalidTransition: "STRAT_LIFECYCLE_INVALID_TRANSITION",
  actorNotPermitted: "STRAT_LIFECYCLE_ACTOR_NOT_PERMITTED",
} as const;

const MACHINE_ORIGIN_STATES: readonly StrategyLifecycleState[] = ["DRAFT", "RESEARCHING"];
const HUMAN_PROMOTION_STATES: readonly StrategyLifecycleState[] = ["PAPER", "LIVE"];
const TERMINAL_STATES: readonly StrategyLifecycleState[] = ["RETIRED"];

export const STRATEGY_LIFECYCLE_TRANSITIONS: readonly StrategyLifecycleTransition[] = [
  { fromState: "DRAFT", toState: "RESEARCHING", actor: "MACHINE" },
  { fromState: "RESEARCHING", toState: "PAPER", actor: "HUMAN" },
  { fromState: "PAPER", toState: "LIVE", actor: "HUMAN" },
  { fromState: "DRAFT", toState: "RETIRED", actor: "HUMAN" },
  { fromState: "RESEARCHING", toState: "RETIRED", actor: "HUMAN" },
  { fromState: "PAPER", toState: "RETIRED", actor: "HUMAN" },
  { fromState: "LIVE", toState: "RETIRED", actor: "HUMAN" },
] as const;

export type LifecycleTransitionValidation =
  | { ok: true }
  | {
      ok: false;
      reasonCode: (typeof strategyLifecycleReasonCodes)[keyof typeof strategyLifecycleReasonCodes];
    };

export function validateStrategyLifecycleTransition(input: {
  fromState: StrategyLifecycleState | null;
  toState: StrategyLifecycleState;
  actor: StrategyLifecycleActor;
  approvalRef?: string | null;
}): LifecycleTransitionValidation {
  if (input.fromState != null && TERMINAL_STATES.includes(input.fromState)) {
    return { ok: false, reasonCode: strategyLifecycleReasonCodes.invalidTransition };
  }

  if (input.fromState == null) {
    if (!MACHINE_ORIGIN_STATES.includes(input.toState)) {
      return { ok: false, reasonCode: strategyLifecycleReasonCodes.invalidTransition };
    }
    if (input.actor !== "MACHINE" && input.actor !== "SERVICE") {
      return { ok: false, reasonCode: strategyLifecycleReasonCodes.actorNotPermitted };
    }
    return { ok: true };
  }

  const allowed = STRATEGY_LIFECYCLE_TRANSITIONS.find(
    (transition) =>
      transition.fromState === input.fromState &&
      transition.toState === input.toState &&
      transition.actor === input.actor,
  );
  if (!allowed) {
    return { ok: false, reasonCode: strategyLifecycleReasonCodes.invalidTransition };
  }

  if (HUMAN_PROMOTION_STATES.includes(input.toState)) {
    if (input.actor !== "HUMAN" || !input.approvalRef) {
      return { ok: false, reasonCode: strategyLifecycleReasonCodes.actorNotPermitted };
    }
  }

  return { ok: true };
}

export function isStrategyLifecycleTradeEligible(state: StrategyLifecycleState): boolean {
  return state === "PAPER" || state === "LIVE";
}
