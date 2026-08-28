import { requireForecastRuntimeAuthorizedOutcomeV2 } from "@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2";
import type { ForecastRuntimeOutcomeV2 } from "@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2";
import type { SubmitOrderResult } from "@/lib/trader/execution/execution-service.types";
import { compareDecimal } from "@/lib/trader/risk/numeric";

export const DECISION_CAPITAL_AUTHORITY_V2_SCHEMA_VERSION =
  "waia.trader.decision_capital_authority.v2" as const;

const DIGEST = /^[0-9a-f]{64}$/;

export type DecisionCapitalProposalV2 = Readonly<{
  action: "ENTER_LONG";
  quantity: string;
  /** Tactical lineage only. It is deliberately not a confidence/economics input. */
  strategySignalId: string | null;
}>;

export type DecisionCapitalRequestV2 = Readonly<{
  organizationId: string;
  accountId: string;
  cycleId: string;
  symbol: string;
  referencePrice: string;
  executionMode: "paper" | "live-equivalent";
  forecastOutcome: ForecastRuntimeOutcomeV2;
  proposal: DecisionCapitalProposalV2;
}>;

export type DecisionAuthorityV2 = Readonly<{
  decisionId: string;
  semanticDigestHex: string;
  contentDigestHex: string;
  forecastAuthorityContentDigestHex: string;
  action: "ENTER_LONG";
  evLower: string;
  evBase: string;
  evUpper: string;
  economicSizeSetId: string;
  economicSizeSetDigestHex: string;
  qualifiedQuantity: string;
}>;

export type DecisionStageOutcomeV2 =
  | Readonly<{
      status: "NO_TRADE";
      decisionId: string;
      decisionContentDigestHex: string;
      forecastAuthorityContentDigestHex: string;
      reasonCodes: readonly string[];
    }>
  | Readonly<{ status: "ACTIONABLE"; decision: DecisionAuthorityV2 }>;

export type RiskStageOutcomeV2 =
  | Readonly<{
      status: "VETO";
      decisionContentDigestHex: string;
      reasonCodes: readonly string[];
    }>
  | Readonly<{
      status: "PERMITTED";
      decisionContentDigestHex: string;
      riskVerdictId: string;
      riskVerdictContentDigestHex: string;
      riskAllowanceId: string;
      riskAllowanceContentDigestHex: string;
      approvedQualifiedQuantity: string;
    }>;

export type ExecutionStageOutcomeV2 = Readonly<{
  decisionContentDigestHex: string;
  riskAllowanceId: string;
  riskAllowanceContentDigestHex: string;
  executionPlanId: string;
  executionPlanContentDigestHex: string;
  executionAttemptId: string;
  executionAttemptContentDigestHex: string;
  submittedQuantity: string;
  execution: SubmitOrderResult;
}>;

export type CanonicalDecisionCapitalAuthorityV2Deps = Readonly<{
  decide(request: DecisionCapitalRequestV2 & { forecastOutcome: Extract<ForecastRuntimeOutcomeV2, { status: "FORECAST_AUTHORIZED" }> }): Promise<DecisionStageOutcomeV2>;
  assessRisk(input: Readonly<{ request: DecisionCapitalRequestV2; decision: DecisionAuthorityV2 }>): Promise<RiskStageOutcomeV2>;
  execute(input: Readonly<{
    request: DecisionCapitalRequestV2;
    decision: DecisionAuthorityV2;
    permission: Extract<RiskStageOutcomeV2, { status: "PERMITTED" }>;
  }>): Promise<ExecutionStageOutcomeV2>;
}>;

export type DecisionCapitalAuthorityV2Result =
  | Readonly<{
      schemaVersion: typeof DECISION_CAPITAL_AUTHORITY_V2_SCHEMA_VERSION;
      status: "NO_TRADE";
      stage: "FORECAST" | "DECISION" | "RISK";
      reasonCodes: readonly string[];
      decisionContentDigestHex: string | null;
    }>
  | Readonly<{
      schemaVersion: typeof DECISION_CAPITAL_AUTHORITY_V2_SCHEMA_VERSION;
      status: "EXECUTION_BOUND";
      decision: DecisionAuthorityV2;
      permission: Extract<RiskStageOutcomeV2, { status: "PERMITTED" }>;
      execution: ExecutionStageOutcomeV2;
    }>;

export class DecisionCapitalAuthorityV2ViolationError extends Error {
  constructor(readonly reason: string) {
    super(`Decision V2 capital authority refused: ${reason}`);
    this.name = "DecisionCapitalAuthorityV2ViolationError";
  }
}

function requireDigest(value: string, field: string): void {
  if (!DIGEST.test(value)) throw new DecisionCapitalAuthorityV2ViolationError(`${field}_INVALID`);
}

function requirePositive(value: string, field: string): void {
  if (!/^\d+(?:\.\d+)?$/.test(value) || compareDecimal(value, "0") <= 0) {
    throw new DecisionCapitalAuthorityV2ViolationError(`${field}_INVALID`);
  }
}

function noTrade(
  stage: "FORECAST" | "DECISION" | "RISK",
  reasonCodes: readonly string[],
  decisionContentDigestHex: string | null = null,
): DecisionCapitalAuthorityV2Result {
  return Object.freeze({
    schemaVersion: DECISION_CAPITAL_AUTHORITY_V2_SCHEMA_VERSION,
    status: "NO_TRADE" as const,
    stage,
    reasonCodes: Object.freeze([...new Set(reasonCodes)].sort()),
    decisionContentDigestHex,
  });
}

/**
 * Sole production composition boundary for new exposure. It never accepts legacy
 * confidence, expected-edge or max-risk fields, and verifies every downstream
 * identity before allowing the next stage to run.
 */
export async function runDecisionCapitalAuthorityV2(
  deps: CanonicalDecisionCapitalAuthorityV2Deps,
  request: DecisionCapitalRequestV2,
): Promise<DecisionCapitalAuthorityV2Result> {
  if (request.forecastOutcome.status !== "FORECAST_AUTHORIZED") {
    return noTrade("FORECAST", [request.forecastOutcome.reason]);
  }
  const forecastOutcome = requireForecastRuntimeAuthorizedOutcomeV2(request.forecastOutcome);
  if (forecastOutcome.authority.organizationId !== request.organizationId) {
    throw new DecisionCapitalAuthorityV2ViolationError("FORECAST_TENANT_MISMATCH");
  }
  requirePositive(request.referencePrice, "REFERENCE_PRICE");
  requirePositive(request.proposal.quantity, "PROPOSED_QUANTITY");

  const decisionOutcome = await deps.decide({ ...request, forecastOutcome });
  if (decisionOutcome.status === "NO_TRADE") {
    requireDigest(decisionOutcome.decisionContentDigestHex, "DECISION_CONTENT_DIGEST");
    if (
      decisionOutcome.forecastAuthorityContentDigestHex !== forecastOutcome.authority.contentDigestHex
    ) {
      throw new DecisionCapitalAuthorityV2ViolationError("DECISION_FORECAST_BINDING_MISMATCH");
    }
    return noTrade(
      "DECISION",
      decisionOutcome.reasonCodes.length > 0
        ? decisionOutcome.reasonCodes
        : ["DECISION_NON_ACTIONABLE"],
      decisionOutcome.decisionContentDigestHex,
    );
  }

  const decision = decisionOutcome.decision;
  [
    [decision.semanticDigestHex, "DECISION_SEMANTIC_DIGEST"],
    [decision.contentDigestHex, "DECISION_CONTENT_DIGEST"],
    [decision.economicSizeSetDigestHex, "ECONOMIC_SIZE_SET_DIGEST"],
  ].forEach(([value, field]) => requireDigest(value, field));
  if (decision.forecastAuthorityContentDigestHex !== forecastOutcome.authority.contentDigestHex) {
    throw new DecisionCapitalAuthorityV2ViolationError("DECISION_FORECAST_BINDING_MISMATCH");
  }
  if (compareDecimal(decision.evLower, "0") <= 0) {
    throw new DecisionCapitalAuthorityV2ViolationError("ACTIONABLE_DECISION_EV_LOWER_NOT_POSITIVE");
  }
  if (
    compareDecimal(decision.evLower, decision.evBase) > 0 ||
    compareDecimal(decision.evBase, decision.evUpper) > 0
  ) {
    throw new DecisionCapitalAuthorityV2ViolationError("DECISION_ECONOMIC_RANGE_INVALID");
  }
  requirePositive(decision.qualifiedQuantity, "DECISION_QUALIFIED_QUANTITY");

  const risk = await deps.assessRisk({ request, decision });
  if (risk.decisionContentDigestHex !== decision.contentDigestHex) {
    throw new DecisionCapitalAuthorityV2ViolationError("RISK_DECISION_BINDING_MISMATCH");
  }
  if (risk.status === "VETO") {
    return noTrade(
      "RISK",
      risk.reasonCodes.length > 0 ? risk.reasonCodes : ["RISK_VETO"],
      decision.contentDigestHex,
    );
  }
  requireDigest(risk.riskVerdictContentDigestHex, "RISK_VERDICT_CONTENT_DIGEST");
  requireDigest(risk.riskAllowanceContentDigestHex, "RISK_ALLOWANCE_CONTENT_DIGEST");
  requirePositive(risk.approvedQualifiedQuantity, "RISK_APPROVED_QUANTITY");
  if (compareDecimal(risk.approvedQualifiedQuantity, decision.qualifiedQuantity) > 0) {
    throw new DecisionCapitalAuthorityV2ViolationError("RISK_QUANTITY_AMPLIFICATION_FORBIDDEN");
  }

  const execution = await deps.execute({ request, decision, permission: risk });
  [
    [execution.executionPlanContentDigestHex, "EXECUTION_PLAN_CONTENT_DIGEST"],
    [execution.executionAttemptContentDigestHex, "EXECUTION_ATTEMPT_CONTENT_DIGEST"],
  ].forEach(([value, field]) => requireDigest(value, field));
  if (
    execution.decisionContentDigestHex !== decision.contentDigestHex ||
    execution.riskAllowanceId !== risk.riskAllowanceId ||
    execution.riskAllowanceContentDigestHex !== risk.riskAllowanceContentDigestHex
  ) {
    throw new DecisionCapitalAuthorityV2ViolationError("EXECUTION_AUTHORITY_BINDING_MISMATCH");
  }
  if (execution.execution.status === "submitted") {
    requirePositive(execution.submittedQuantity, "EXECUTION_SUBMITTED_QUANTITY");
    if (compareDecimal(execution.submittedQuantity, risk.approvedQualifiedQuantity) > 0) {
      throw new DecisionCapitalAuthorityV2ViolationError("EXECUTION_QUANTITY_AMPLIFICATION_FORBIDDEN");
    }
  }
  return Object.freeze({
    schemaVersion: DECISION_CAPITAL_AUTHORITY_V2_SCHEMA_VERSION,
    status: "EXECUTION_BOUND" as const,
    decision,
    permission: risk,
    execution,
  });
}
