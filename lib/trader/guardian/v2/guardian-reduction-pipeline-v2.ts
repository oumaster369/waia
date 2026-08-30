import {
  validateExecutionPlanV2,
  validateExecutionReportV2,
  type ExecutionPlanV2,
  type ExecutionReportV2,
} from "@/lib/trader/execution/v2/contracts";
import type { OpeningCausalLineageV1 } from "@/lib/trader/lifecycle/opening-causal-lineage-v1";
import type { PositionLotRow } from "@/lib/trader/lifecycle/trade-lifecycle.types";
import {
  validateRealityProjectionV2,
  type RealityProjectionV2,
} from "@/lib/trader/reality/v2/contracts";
import { compareDecimal, formatDecimal, isPositiveDecimal, parseDecimal } from "@/lib/trader/risk/numeric";
import {
  validateRiskAllowanceV2,
  type RiskAllowanceV2,
} from "@/lib/trader/risk/v2/risk-allowance-v2";

import { assertGuardianAssessmentV2, type GuardianAssessmentV2 } from "./guardian-assessment-v2";
import { assertProtectiveActionMandateV2, type ProtectiveActionMandateV2 } from "./protective-action-mandate-v2";
import { assertProtectiveTriggerProofV2, type ProtectiveTriggerProofV2 } from "./protective-trigger-proof-v2";

export type GuardianDecisionSealV2 = Readonly<{
  organizationId: string;
  guardianAssessmentId: string;
  guardianAssessmentContentDigest: string;
  decisionId: string;
  decisionContentDigest: string;
  action: "REDUCE" | "CLOSE";
  approvedQuantity: string;
}>;

export interface GuardianDecisionPortV2 {
  decideReduction(input: Readonly<{
    assessment: GuardianAssessmentV2;
    lot: PositionLotRow;
  }>): Promise<GuardianDecisionSealV2>;
}

export interface GuardianRiskPortV2 {
  authorizeReduction(input: Readonly<{
    assessment: GuardianAssessmentV2;
    decision: GuardianDecisionSealV2;
    lot: PositionLotRow;
  }>): Promise<RiskAllowanceV2>;
}

export interface GuardianExecutionPortV2 {
  executeReduction(input: Readonly<{
    assessment: GuardianAssessmentV2;
    decision: GuardianDecisionSealV2;
    allowance: RiskAllowanceV2;
    lot: PositionLotRow;
  }>): Promise<Readonly<{ plan: ExecutionPlanV2; reports: readonly ExecutionReportV2[] }>>;
}

export interface GuardianRealityPortV2 {
  ingestExecutionReports(input: Readonly<{
    organizationId: string;
    accountId: string;
    reports: readonly ExecutionReportV2[];
  }>): Promise<RealityProjectionV2>;
}

export type GuardianReductionPipelinePortsV2 = Readonly<{
  decision: GuardianDecisionPortV2;
  risk: GuardianRiskPortV2;
  execution: GuardianExecutionPortV2;
  reality: GuardianRealityPortV2;
}>;

export type GuardianReductionPipelineResultV2 = Readonly<{
  assessment: GuardianAssessmentV2;
  decision: GuardianDecisionSealV2;
  allowance: RiskAllowanceV2;
  plan: ExecutionPlanV2;
  reports: readonly ExecutionReportV2[];
  reality: RealityProjectionV2;
}>;

function assertLotBinding(
  assessment: GuardianAssessmentV2,
  lot: PositionLotRow,
  openingLineage: OpeningCausalLineageV1,
): void {
  if (
    lot.state !== "OPEN" || !isPositiveDecimal(lot.remainingQty) ||
    lot.organizationId !== assessment.organizationId || lot.tradeId !== assessment.positionId ||
    lot.id !== assessment.lotId || lot.symbol !== assessment.symbol
  ) throw new Error("GUARDIAN_PIPELINE_OPEN_LOT_MISMATCH");
  if (
    openingLineage.organizationId !== assessment.organizationId ||
    openingLineage.symbol !== assessment.symbol ||
    openingLineage.contentDigest !== assessment.openingCausalLineageDigest
  ) throw new Error("GUARDIAN_PIPELINE_OPENING_LINEAGE_MISMATCH");
}

function assertDecision(
  assessment: GuardianAssessmentV2,
  lot: PositionLotRow,
  decision: GuardianDecisionSealV2,
): void {
  if (
    decision.organizationId !== assessment.organizationId ||
    decision.guardianAssessmentId !== assessment.assessmentId ||
    decision.guardianAssessmentContentDigest !== assessment.contentDigest
  ) throw new Error("GUARDIAN_PIPELINE_DECISION_BINDING_MISMATCH");
  const expected = assessment.recommendation === "REDUCE_FULL" ? "CLOSE" : "REDUCE";
  if (decision.action !== expected) throw new Error("GUARDIAN_PIPELINE_DECISION_ACTION_MISMATCH");
  if (!isPositiveDecimal(decision.approvedQuantity) || compareDecimal(decision.approvedQuantity, lot.remainingQty) > 0) {
    throw new Error("GUARDIAN_PIPELINE_DECISION_WOULD_INCREASE_OR_REVERSE");
  }
}

function assertAllowance(
  assessment: GuardianAssessmentV2,
  decision: GuardianDecisionSealV2,
  lot: PositionLotRow,
  allowance: RiskAllowanceV2,
): void {
  if (!validateRiskAllowanceV2(allowance)) throw new Error("GUARDIAN_PIPELINE_RISK_ALLOWANCE_INVALID");
  if (
    allowance.organizationId !== assessment.organizationId || allowance.accountId !== lot.accountKey ||
    allowance.symbol !== lot.symbol || !allowance.strictExposureReduction ||
    allowance.decision.decisionId !== decision.decisionId ||
    allowance.decision.contentDigestHex !== decision.decisionContentDigest ||
    allowance.decision.action !== decision.action ||
    compareDecimal(allowance.exactQualifiedQuantity, decision.approvedQuantity) > 0 ||
    compareDecimal(allowance.exactQualifiedQuantity, lot.remainingQty) > 0
  ) throw new Error("GUARDIAN_PIPELINE_RISK_BINDING_MISMATCH");
}

function assertExecution(
  assessment: GuardianAssessmentV2,
  openingLineage: OpeningCausalLineageV1,
  lot: PositionLotRow,
  allowance: RiskAllowanceV2,
  plan: ExecutionPlanV2,
  reports: readonly ExecutionReportV2[],
): void {
  if (!validateExecutionPlanV2(plan)) throw new Error("GUARDIAN_PIPELINE_EXECUTION_PLAN_INVALID");
  const reducingSide = lot.positionSide === "LONG" ? "sell" : "buy";
  if (
    plan.organizationId !== assessment.organizationId || plan.accountId !== lot.accountKey ||
    plan.riskAllowanceId !== allowance.riskAllowanceId ||
    plan.riskAllowanceContentDigestHex !== allowance.contentDigestHex ||
    plan.action !== allowance.decision.action || plan.side !== reducingSide ||
    (plan.action !== "REDUCE" && plan.action !== "CLOSE") ||
    compareDecimal(plan.plannedQuantity, lot.remainingQty) > 0 ||
    plan.canonicalCausalLineageDigestHex !== openingLineage.canonicalCausalLineageDigest
  ) throw new Error("GUARDIAN_PIPELINE_EXECUTION_BINDING_MISMATCH");
  if (
    reports.length === 0 || reports.some((report) =>
      !validateExecutionReportV2(report) || report.organizationId !== assessment.organizationId ||
      report.accountId !== lot.accountKey)
  ) throw new Error("GUARDIAN_PIPELINE_EXECUTION_REPORT_INVALID");
}

export async function runGuardianOrdinaryReductionPipelineV2(input: Readonly<{
  assessment: GuardianAssessmentV2;
  lot: PositionLotRow;
  openingLineage: OpeningCausalLineageV1;
  ports: GuardianReductionPipelinePortsV2;
}>): Promise<GuardianReductionPipelineResultV2> {
  assertGuardianAssessmentV2(input.assessment);
  if (input.assessment.recommendation === "HOLD") {
    throw new Error("GUARDIAN_PIPELINE_HOLD_HAS_NO_ACTION");
  }
  assertLotBinding(input.assessment, input.lot, input.openingLineage);
  const decision = await input.ports.decision.decideReduction({ assessment: input.assessment, lot: input.lot });
  assertDecision(input.assessment, input.lot, decision);
  const allowance = await input.ports.risk.authorizeReduction({ assessment: input.assessment, decision, lot: input.lot });
  assertAllowance(input.assessment, decision, input.lot, allowance);
  const execution = await input.ports.execution.executeReduction({
    assessment: input.assessment, decision, allowance, lot: input.lot,
  });
  assertExecution(input.assessment, input.openingLineage, input.lot, allowance, execution.plan, execution.reports);
  const reality = await input.ports.reality.ingestExecutionReports({
    organizationId: input.assessment.organizationId,
    accountId: input.lot.accountKey,
    reports: execution.reports,
  });
  if (
    !validateRealityProjectionV2(reality) || reality.organizationId !== input.assessment.organizationId ||
    reality.accountId !== input.lot.accountKey
  ) throw new Error("GUARDIAN_PIPELINE_REALITY_BINDING_MISMATCH");
  return Object.freeze({
    assessment: input.assessment, decision, allowance, plan: execution.plan,
    reports: Object.freeze([...execution.reports]), reality,
  });
}

export async function runGuardianProtectiveReductionPipelineV2(input: Readonly<{
  assessment: GuardianAssessmentV2;
  mandate: ProtectiveActionMandateV2;
  triggerProof: ProtectiveTriggerProofV2;
  lot: PositionLotRow;
  openingLineage: OpeningCausalLineageV1;
  ports: Omit<GuardianReductionPipelinePortsV2, "decision">;
}>): Promise<GuardianReductionPipelineResultV2> {
  assertGuardianAssessmentV2(input.assessment);
  assertProtectiveActionMandateV2(input.mandate);
  assertProtectiveTriggerProofV2(input.triggerProof);
  assertLotBinding(input.assessment, input.lot, input.openingLineage);
  if (input.mandate.actionKind === "TIGHTEN_PROTECTION") {
    throw new Error("GUARDIAN_PROTECTIVE_TIGHTEN_REQUIRES_DEDICATED_EXECUTOR");
  }
  if (
    input.mandate.organizationId !== input.assessment.organizationId ||
    input.mandate.positionId !== input.assessment.positionId || input.mandate.lotId !== input.assessment.lotId ||
    input.mandate.symbol !== input.assessment.symbol ||
    input.mandate.openingCausalLineageDigest !== input.assessment.openingCausalLineageDigest ||
    input.mandate.guardianAssessmentId !== input.assessment.assessmentId ||
    input.mandate.guardianAssessmentContentDigest !== input.assessment.contentDigest
  ) throw new Error("GUARDIAN_PROTECTIVE_MANDATE_BINDING_MISMATCH");
  if (
    input.triggerProof.mandateId !== input.mandate.mandateId ||
    input.triggerProof.mandateContentDigest !== input.mandate.contentDigest ||
    input.triggerProof.deterministicTriggerSpecDigest !== input.mandate.deterministicTriggerSpecDigest ||
    input.triggerProof.realityProjectionId !== input.assessment.realityFrontierId ||
    input.triggerProof.realityContentDigest !== input.assessment.realityContentDigest ||
    new Date(input.triggerProof.observedAtUtc).getTime() > new Date(input.mandate.validUntilUtc).getTime()
  ) throw new Error("GUARDIAN_PROTECTIVE_TRIGGER_BINDING_MISMATCH");
  const action = input.mandate.actionKind === "CLOSE_FULL" ? "CLOSE" : "REDUCE";
  const approvedQuantity = input.mandate.actionKind === "CLOSE_FULL"
    ? input.lot.remainingQty
    : formatDecimal((parseDecimal(input.lot.remainingQty) * BigInt(input.mandate.maximumReductionBps)) / 10_000n);
  const decision: GuardianDecisionSealV2 = Object.freeze({
    organizationId: input.mandate.organizationId,
    guardianAssessmentId: input.assessment.assessmentId,
    guardianAssessmentContentDigest: input.assessment.contentDigest,
    decisionId: input.mandate.decisionId,
    decisionContentDigest: input.mandate.decisionContentDigest,
    action,
    approvedQuantity,
  });
  assertDecision(input.assessment, input.lot, decision);
  const allowance = await input.ports.risk.authorizeReduction({ assessment: input.assessment, decision, lot: input.lot });
  assertAllowance(input.assessment, decision, input.lot, allowance);
  const execution = await input.ports.execution.executeReduction({ assessment: input.assessment, decision, allowance, lot: input.lot });
  assertExecution(input.assessment, input.openingLineage, input.lot, allowance, execution.plan, execution.reports);
  const reality = await input.ports.reality.ingestExecutionReports({
    organizationId: input.assessment.organizationId, accountId: input.lot.accountKey, reports: execution.reports,
  });
  if (!validateRealityProjectionV2(reality) || reality.organizationId !== input.assessment.organizationId || reality.accountId !== input.lot.accountKey) {
    throw new Error("GUARDIAN_PIPELINE_REALITY_BINDING_MISMATCH");
  }
  return Object.freeze({ assessment: input.assessment, decision, allowance, plan: execution.plan, reports: Object.freeze([...execution.reports]), reality });
}
