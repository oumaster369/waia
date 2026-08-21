import type { RiskBindingLayerV2 } from "./risk-verdict-contract-v2";

export const RISK_REASON_CODES_V2 = {
  L0: ["POLICY_NOT_VALIDATED", "POLICY_IDENTITY_INVALID"],
  L1: ["TENANT_ENVELOPE_INELIGIBLE", "MARKET_OUTSIDE_ENVELOPE", "ALLOCATION_UNAVAILABLE"],
  L2: ["POSITION_LIMIT_BINDING", "LOSS_LIMIT_BINDING", "DRAWDOWN_LIMIT_BINDING", "TURNOVER_LIMIT_BINDING"],
  L3: ["AGGREGATE_LIMIT_BINDING", "CONCENTRATION_LIMIT_BINDING", "CAPACITY_EXHAUSTED", "ADMISSION_CONTENTION"],
  L4: ["KILL_SWITCH_TRIPPED", "KILL_STATE_UNKNOWN"],
  L5: ["EXECUTION_FAIL_CLOSED", "EXCHANGE_CAP_UNAVAILABLE", "CURRENT_POSTURE_RESTRICTED"],
  L6: ["RECONCILIATION_DIVERGENCE", "RECONCILIATION_UNAVAILABLE", "REALITY_STATE_STALE"],
} as const satisfies Readonly<Record<RiskBindingLayerV2, readonly string[]>>;

export type RiskReasonCodeV2 = (typeof RISK_REASON_CODES_V2)[RiskBindingLayerV2][number];

const LAYER_BY_REASON = new Map<RiskReasonCodeV2, RiskBindingLayerV2>(
  Object.entries(RISK_REASON_CODES_V2).flatMap(([layer, codes]) =>
    codes.map((code) => [code, layer as RiskBindingLayerV2] as const),
  ),
);

export function isRiskReasonCodeV2(value: string): value is RiskReasonCodeV2 {
  return LAYER_BY_REASON.has(value as RiskReasonCodeV2);
}

export function riskLayerForReasonCodeV2(code: RiskReasonCodeV2): RiskBindingLayerV2 {
  return LAYER_BY_REASON.get(code)!;
}

export function validateRiskReasonsForLayersV2(input: {
  bindingLayers: readonly RiskBindingLayerV2[];
  reasonCodes: readonly string[];
}): boolean {
  const layers = new Set(input.bindingLayers);
  return input.reasonCodes.every(
    (code) => isRiskReasonCodeV2(code) && layers.has(riskLayerForReasonCodeV2(code)),
  );
}
