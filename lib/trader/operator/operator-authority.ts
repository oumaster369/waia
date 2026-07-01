export const OPERATOR_ALLOWED_ACTIONS = [
  "read_market_state",
  "read_kb_registers",
  "read_backtest_results",
  "propose_hypothesis",
  "propose_strategy_candidate",
  "trigger_backtest_job",
  "trigger_walk_forward_job",
  "draft_gate_package",
  "persist_operator_memory",
  "recommend_strategy_review",
  "append_audit_log",
] as const;

export type OperatorAllowedAction = (typeof OPERATOR_ALLOWED_ACTIONS)[number];

export const OPERATOR_FORBIDDEN_ACTIONS = [
  "promote_strategy",
  "mutate_promotion_fsm",
  "live_enable_trading",
  "place_order",
  "move_funds",
  "mutate_balances",
  "mutate_risk_limits",
  "mutate_kill_switch",
  "mutate_thresholds",
  "mutate_sealed_datasets",
  "mutate_digests",
  "open_blind_validation",
  "score_own_evidence",
  "bypass_attestation",
] as const;

export type OperatorForbiddenAction = (typeof OPERATOR_FORBIDDEN_ACTIONS)[number];

export type OperatorActionKind = OperatorAllowedAction | OperatorForbiddenAction;

export class OperatorAuthorityError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "OperatorAuthorityError";
    this.code = code;
  }
}

const forbiddenSet = new Set<string>(OPERATOR_FORBIDDEN_ACTIONS);

export function isOperatorActionAllowed(action: string): action is OperatorAllowedAction {
  return (OPERATOR_ALLOWED_ACTIONS as readonly string[]).includes(action);
}

export function assertOperatorActionAllowed(
  action: string,
): asserts action is OperatorAllowedAction {
  if (forbiddenSet.has(action)) {
    throw new OperatorAuthorityError("OPERATOR_ACTION_FORBIDDEN", `Forbidden action: ${action}`);
  }
  if (!isOperatorActionAllowed(action)) {
    throw new OperatorAuthorityError("OPERATOR_ACTION_UNKNOWN", `Unknown action: ${action}`);
  }
}
