import {
  createHistoricalSimulationAtomicStageBundleV2,
  type HistoricalSimulationAtomicStageBundlesV2,
} from "./atomic-cycle-commit-v2";
import { createHistoricalSimulationModeledAtomicArtifactV2,
  type HistoricalSimulationModeledAtomicArtifactV2 } from "./atomic-cycle-repository-postgres-v2";
import type { HistoricalSimulationReasonLedgerV2 } from "./reason-ledger-v2";
import type { HistoricalModeledRiskReceiptV2, HistoricalModeledExecutionReceiptV2 } from
  "./modeled-capital-binding-v2";
import type { AdvanceHistoricalModeledExecutionV2Result } from "./modeled-execution-advance-v2";
import type { DecisionEvaluationReceiptV1, WhyNotCashReceiptV2 } from
  "@/lib/trader/intelligence/decision-economics/dee660-why-not-cash-receipt-v2";
import type { HistoricalSimulationDurableStateSnapshotV2 } from "./atomic-cycle-commit-v2";
import { canonicalizeSemanticJsonString, computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { projectHistoricalModeledEffectsToReasonLedgerV2 } from "./modeled-execution-advance-v2";

type ModeledStage = "MODELED_RISK" | "MODELED_EXECUTION" | "OBSERVED_EXECUTION_EFFECTS" |
  "GUARDIAN" | "KNOWLEDGE" | "LEARNING";
type ModeledArtifacts = Readonly<Record<ModeledStage,
  readonly [HistoricalSimulationModeledAtomicArtifactV2, ...HistoricalSimulationModeledAtomicArtifactV2[]]>>;

const DIGEST = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type AtomicScope = Readonly<{ organizationId: string; accountId: string; runId: string;
  cycleId: string; pitAnchor: string }>;

function modeled(scope: AtomicScope, artifactKind: HistoricalSimulationModeledAtomicArtifactV2["artifactKind"],
  artifactId: string, sourceContentDigestHex: string, sourcePayload: Readonly<Record<string, unknown>>,
  lineagePayload?: Readonly<Record<string, unknown>>): HistoricalSimulationModeledAtomicArtifactV2 {
  return createHistoricalSimulationModeledAtomicArtifactV2({ ...scope, artifactKind, artifactId,
    sourceContentDigestHex, sourcePayload, ...(lineagePayload ? { lineagePayload } : {}) });
}

function asNonEmptyArtifacts(artifacts: readonly HistoricalSimulationModeledAtomicArtifactV2[], field: string):
readonly [HistoricalSimulationModeledAtomicArtifactV2, ...HistoricalSimulationModeledAtomicArtifactV2[]] {
  if (!artifacts[0]) throw new Error(`HISTORICAL_SIMULATION_V2_PRODUCTION_REFUSED:${field}`);
  return [artifacts[0], ...artifacts.slice(1)];
}

function observedEffectArtifacts(scope: AtomicScope, advance: AdvanceHistoricalModeledExecutionV2Result):
readonly [HistoricalSimulationModeledAtomicArtifactV2, ...HistoricalSimulationModeledAtomicArtifactV2[]] {
  const artifacts: HistoricalSimulationModeledAtomicArtifactV2[] = [];
  for (const effect of advance.effects) {
    if (effect.reportContentDigestHexes.length !== 1) throw new Error("HISTORICAL_SIMULATION_V2_PRODUCTION_REFUSED:REPORT_CARDINALITY");
    const report = Object.freeze({ schemaVersion: "waia.trader.historical_modeled_execution_report.v2",
      source: "MODELED_HISTORICAL", capitalEligible: false, cycleId: scope.cycleId,
      decisionId: effect.decisionId, decisionContentDigestHex: effect.decisionContentDigestHex,
      executionPlanId: effect.executionPlanId, executionPlanContentDigestHex: effect.executionPlanContentDigestHex,
      orderId: effect.orderId, orderContentDigestHex: effect.orderContentDigestHex,
      executionAttemptId: effect.executionAttemptId, executionAttemptContentDigestHex: effect.executionAttemptContentDigestHex,
      status: effect.status, fillEvidenceContentDigestHexes: effect.fillEvidenceContentDigestHexes });
    artifacts.push(modeled(scope, "MODELED_EXECUTION_EFFECT", effect.effectId, effect.reportContentDigestHexes[0]!, report));
    for (const digest of effect.fillEvidenceContentDigestHexes) {
      const detail = advance.fillDetails.find((candidate) => candidate.evidence.contentDigestHex === digest);
      if (!detail) throw new Error("HISTORICAL_SIMULATION_V2_PRODUCTION_REFUSED:FILL_DETAIL_MISSING");
      artifacts.push(modeled(scope, "MODELED_EXECUTION_EFFECT", detail.evidence.fillId, digest, detail.evidence,
        Object.freeze({ originatingDecisionId: effect.decisionId,
          originatingDecisionContentDigestHex: effect.decisionContentDigestHex,
          originatingPlanId: effect.executionPlanId, originatingAttemptId: effect.executionAttemptId,
          status: effect.status, fillDetail: detail })));
    }
  }
  if (!artifacts[0]) throw new Error("HISTORICAL_SIMULATION_V2_PRODUCTION_REFUSED:EFFECT_ARTIFACT_EMPTY");
  return artifacts as [HistoricalSimulationModeledAtomicArtifactV2, ...HistoricalSimulationModeledAtomicArtifactV2[]];
}

/** Exact modeled capital/effect projection; no caller-created digest or evidence sink is accepted. */
export function buildHistoricalSimulationModeledCapitalArtifactsV2(input: Readonly<{
  scope: AtomicScope;
  risk: HistoricalModeledRiskReceiptV2;
  execution: HistoricalModeledExecutionReceiptV2;
  advance: AdvanceHistoricalModeledExecutionV2Result;
  decisionEvidence: Readonly<{ decisionReceipt: DecisionEvaluationReceiptV1;
    whyNotCashReceipt: WhyNotCashReceiptV2 }>;
}>): Readonly<Pick<ModeledArtifacts, "MODELED_RISK" | "MODELED_EXECUTION" | "OBSERVED_EXECUTION_EFFECTS">> {
  const decisionLineage = Object.freeze({ decisionReceipt: input.decisionEvidence.decisionReceipt,
    whyNotCashReceipt: input.decisionEvidence.whyNotCashReceipt });
  const riskArtifacts: HistoricalSimulationModeledAtomicArtifactV2[] = [modeled(input.scope,
    "MODELED_RISK_VERDICT", input.risk.riskVerdictId, input.risk.contentDigestHex, input.risk, decisionLineage)];
  if (input.risk.riskAllowanceId && input.risk.riskAllowanceContentDigestHex) {
    const allowance = Object.freeze({ schemaVersion: "waia.trader.historical_modeled_risk_allowance.v2",
      source: "MODELED_HISTORICAL", capitalEligible: false, allowanceId: input.risk.riskAllowanceId,
      riskVerdictId: input.risk.riskVerdictId, decisionContentDigestHex: input.risk.decisionContentDigestHex,
      approvedQuantity: input.risk.approvedQuantity });
    riskArtifacts.push(modeled(input.scope, "MODELED_RISK_VERDICT", input.risk.riskAllowanceId,
      input.risk.riskAllowanceContentDigestHex, allowance, decisionLineage));
  }
  const plan = Object.freeze({ schemaVersion: "waia.trader.historical_modeled_execution_plan.v2",
    source: "MODELED_HISTORICAL", capitalEligible: false, executionPlanId: input.execution.executionPlanId,
    decisionId: input.execution.decisionId, decisionContentDigestHex: input.execution.decisionContentDigestHex,
    riskReceiptContentDigestHex: input.execution.riskReceiptContentDigestHex, symbol: input.execution.symbol,
    side: input.execution.side, quantity: input.execution.quantity });
  const attempt = Object.freeze({ schemaVersion: "waia.trader.historical_modeled_execution_attempt.v2",
    source: "MODELED_HISTORICAL", capitalEligible: false,
    executionAttemptId: input.execution.executionAttemptId, executionPlanId: input.execution.executionPlanId,
    executionPlanContentDigestHex: input.execution.executionPlanContentDigestHex,
    acceptedAtUtc: input.execution.acceptedAtUtc });
  const executionArtifacts = [modeled(input.scope, "MODELED_EXECUTION_SUBMISSION", input.execution.executionPlanId,
    input.execution.executionPlanContentDigestHex, plan), modeled(input.scope, "MODELED_EXECUTION_SUBMISSION",
    input.execution.executionAttemptId, input.execution.executionAttemptContentDigestHex, attempt)] as const;
  const effects: HistoricalSimulationModeledAtomicArtifactV2[] = input.advance.effects.length > 0
    ? [...observedEffectArtifacts(input.scope, input.advance)] : [];
  if (effects.length === 0) {
    const payload = Object.freeze({ effects: [] as readonly never[] });
    effects.push(modeled(input.scope, "MODELED_EXECUTION_EFFECT", `no-effects:${input.scope.cycleId}`,
      computeSemanticSha256Hex(payload), payload));
  }
  return Object.freeze({ MODELED_RISK: Object.freeze(riskArtifacts) as ModeledArtifacts["MODELED_RISK"],
    MODELED_EXECUTION: executionArtifacts,
    OBSERVED_EXECUTION_EFFECTS: Object.freeze(effects) as ModeledArtifacts["OBSERVED_EXECUTION_EFFECTS"] });
}

/** Canonical evidence for CASH, forecast refusal, Risk VETO, and cycles with no eligible prior order. */
export function buildHistoricalSimulationModeledNoopArtifactsV2(input: Readonly<{
  scope: AtomicScope;
  ledgerEntry: HistoricalSimulationReasonLedgerV2;
  decisionEvidence: Readonly<{ decisionReceipt: DecisionEvaluationReceiptV1;
    whyNotCashReceipt: WhyNotCashReceiptV2 }> | null;
  advance?: AdvanceHistoricalModeledExecutionV2Result;
}>): Readonly<Pick<ModeledArtifacts, "MODELED_RISK" | "MODELED_EXECUTION" | "OBSERVED_EXECUTION_EFFECTS">> {
  if (input.decisionEvidence === null && input.ledgerEntry.forecast.status !== "NON_ACTIONABLE") {
    throw new Error("HISTORICAL_SIMULATION_V2_PRODUCTION_REFUSED:DECISION_EVIDENCE_REQUIRED");
  }
  const lineage = input.decisionEvidence ? Object.freeze({ decisionReceipt: input.decisionEvidence.decisionReceipt,
    whyNotCashReceipt: input.decisionEvidence.whyNotCashReceipt }) : Object.freeze({ forecastTerminal: Object.freeze({
      forecast: input.ledgerEntry.forecast, decision: input.ledgerEntry.decision }) });
  const riskDigest = computeSemanticSha256Hex(input.ledgerEntry.risk);
  const executionDigest = computeSemanticSha256Hex(input.ledgerEntry.execution);
  const effectsPayload = Object.freeze({ effects: input.ledgerEntry.observedExecutionEffects });
  if (input.advance && canonicalizeSemanticJsonString(projectHistoricalModeledEffectsToReasonLedgerV2(input.advance)) !==
      canonicalizeSemanticJsonString(input.ledgerEntry.observedExecutionEffects)) {
    throw new Error("HISTORICAL_SIMULATION_V2_PRODUCTION_REFUSED:OBSERVED_EFFECT_LEDGER_PARITY");
  }
  if (input.ledgerEntry.risk.verdictContentDigestHex !== null ||
      input.ledgerEntry.execution.planContentDigestHex !== null ||
      input.ledgerEntry.risk.status !== "NOT_EVALUATED" ||
      input.ledgerEntry.execution.status !== "NOT_DISPATCHED") {
    throw new Error("HISTORICAL_SIMULATION_V2_PRODUCTION_REFUSED:NOOP_STAGE_NOT_EMPTY");
  }
  return Object.freeze({
    MODELED_RISK: [modeled(input.scope, "MODELED_RISK_VERDICT", `noop-risk:${input.scope.cycleId}`,
      riskDigest, input.ledgerEntry.risk, lineage)],
    MODELED_EXECUTION: [modeled(input.scope, "MODELED_EXECUTION_SUBMISSION", `noop-execution:${input.scope.cycleId}`,
      executionDigest, input.ledgerEntry.execution)],
    OBSERVED_EXECUTION_EFFECTS: asNonEmptyArtifacts(input.advance && input.advance.effects.length > 0
      ? observedEffectArtifacts(input.scope, input.advance)
      : [modeled(input.scope, "MODELED_EXECUTION_EFFECT", `noop-effects:${input.scope.cycleId}`,
        computeSemanticSha256Hex(effectsPayload), effectsPayload)], "NOOP_EFFECT_ARTIFACT_EMPTY"),
  });
}

/** A real modeled Risk VETO plus truthful no-submission/no-effect evidence. */
export function buildHistoricalSimulationModeledVetoArtifactsV2(input: Readonly<{
  scope: AtomicScope; ledgerEntry: HistoricalSimulationReasonLedgerV2;
  risk: HistoricalModeledRiskReceiptV2;
  decisionEvidence: Readonly<{ decisionReceipt: DecisionEvaluationReceiptV1;
    whyNotCashReceipt: WhyNotCashReceiptV2 }>;
  advance?: AdvanceHistoricalModeledExecutionV2Result;
}>): Readonly<Pick<ModeledArtifacts, "MODELED_RISK" | "MODELED_EXECUTION" | "OBSERVED_EXECUTION_EFFECTS">> {
  if (input.risk.verdict !== "VETO" || input.risk.riskAllowanceId !== null ||
      input.ledgerEntry.risk.verdictContentDigestHex !== input.risk.contentDigestHex ||
      input.ledgerEntry.execution.planContentDigestHex !== null) {
    throw new Error("HISTORICAL_SIMULATION_V2_PRODUCTION_REFUSED:VETO_STAGE_IDENTITY");
  }
  const lineage = Object.freeze({ decisionReceipt: input.decisionEvidence.decisionReceipt,
    whyNotCashReceipt: input.decisionEvidence.whyNotCashReceipt });
  const executionPayload = input.ledgerEntry.execution;
  const effectsPayload = Object.freeze({ effects: input.ledgerEntry.observedExecutionEffects });
  if (input.advance && canonicalizeSemanticJsonString(projectHistoricalModeledEffectsToReasonLedgerV2(input.advance)) !==
      canonicalizeSemanticJsonString(input.ledgerEntry.observedExecutionEffects)) {
    throw new Error("HISTORICAL_SIMULATION_V2_PRODUCTION_REFUSED:OBSERVED_EFFECT_LEDGER_PARITY");
  }
  const effectArtifacts = input.advance && input.advance.effects.length > 0
    ? observedEffectArtifacts(input.scope, input.advance)
    : [modeled(input.scope, "MODELED_EXECUTION_EFFECT", `veto-effects:${input.scope.cycleId}`,
      computeSemanticSha256Hex(effectsPayload), effectsPayload)];
  return Object.freeze({ MODELED_RISK: [modeled(input.scope, "MODELED_RISK_VERDICT", input.risk.riskVerdictId,
    input.risk.contentDigestHex, input.risk, lineage)], MODELED_EXECUTION: [modeled(input.scope,
    "MODELED_EXECUTION_SUBMISSION", `veto-execution:${input.scope.cycleId}`,
    computeSemanticSha256Hex(executionPayload), executionPayload)],
    OBSERVED_EXECUTION_EFFECTS: asNonEmptyArtifacts(effectArtifacts, "VETO_EFFECT_ARTIFACT_EMPTY") });
}

function requireDomainPayloadDigest(payload: Readonly<Record<string, unknown>>, digest: string, field: string): void {
  const body = { ...payload }; const embedded = body.contentDigestHex; delete body.contentDigestHex;
  const computed = computeSemanticSha256Hex(typeof embedded === "string" ? body : payload);
  if (!DIGEST.test(digest) || computed !== digest || (typeof embedded === "string" && embedded !== digest)) {
    throw new Error(`HISTORICAL_SIMULATION_V2_PRODUCTION_REFUSED:${field}`);
  }
}

/** Completes the remaining Guardian/Knowledge/Learning modeled stages from sealed component outputs. */
export function buildHistoricalSimulationModeledStateArtifactsV2(input: Readonly<{
  scope: AtomicScope;
  guardian: Readonly<{ id: string; contentDigestHex: string; payload: Readonly<Record<string, unknown>> }>;
  knowledge: Readonly<{ id: string; contentDigestHex: string; payload: Readonly<Record<string, unknown>> }>;
  learning: readonly [Readonly<{ id: string; contentDigestHex: string;
    payload: Readonly<Record<string, unknown>> }>, ...Readonly<{ id: string; contentDigestHex: string;
    payload: Readonly<Record<string, unknown>> }>[]];
  previousLearningSnapshot: HistoricalSimulationDurableStateSnapshotV2<"LEARNING"> | null;
  nextLearningSnapshot: HistoricalSimulationDurableStateSnapshotV2<"LEARNING">;
}>): Readonly<Pick<ModeledArtifacts, "GUARDIAN" | "KNOWLEDGE" | "LEARNING">> {
  requireDomainPayloadDigest(input.guardian.payload, input.guardian.contentDigestHex, "GUARDIAN_PAYLOAD");
  requireDomainPayloadDigest(input.knowledge.payload, input.knowledge.contentDigestHex, "KNOWLEDGE_PAYLOAD");
  const guardian = modeled(input.scope, "GUARDIAN_ASSESSMENT", input.guardian.id,
    input.guardian.contentDigestHex, input.guardian.payload);
  const knowledge = modeled(input.scope, "KNOWLEDGE_CHECKPOINT", input.knowledge.id,
    input.knowledge.contentDigestHex, input.knowledge.payload);
  const transition = Object.freeze({
    previousSnapshotContentDigestHex: input.previousLearningSnapshot?.contentDigestHex ?? null,
    nextSnapshotContentDigestHex: input.nextLearningSnapshot.contentDigestHex,
    previousState: input.previousLearningSnapshot?.state ?? null,
    nextState: input.nextLearningSnapshot.state,
  });
  const learning = input.learning.map((entry) => {
    requireDomainPayloadDigest(entry.payload, entry.contentDigestHex, "LEARNING_PAYLOAD");
    const payload = Object.freeze({ ...entry.payload, previousState: transition.previousState,
      nextState: transition.nextState });
    // The domain digest must cover the transition-bearing payload; callers cannot attach it later.
    requireDomainPayloadDigest(payload, entry.contentDigestHex, "LEARNING_TRANSITION_PAYLOAD");
    return modeled(input.scope, "LEARNING_UPDATE", entry.id, entry.contentDigestHex, payload, transition);
  }) as unknown as ModeledArtifacts["LEARNING"];
  return Object.freeze({ GUARDIAN: [guardian], KNOWLEDGE: [knowledge], LEARNING: learning });
}

/** Mechanical 9-stage projection only; every modeled payload must already be content-addressed domain evidence. */
export function buildHistoricalSimulationProductionStageBundlesV2(input: Readonly<{
  ledgerEntry: HistoricalSimulationReasonLedgerV2;
  forecast: Readonly<{ id: string; contentDigestHex: string }>;
  canonicalVerification: Readonly<{ id: string; contentDigestHex: string }>;
  accounting: Readonly<{ id: string; contentDigestHex: string }>;
  modeled: ModeledArtifacts;
}>): HistoricalSimulationAtomicStageBundlesV2 {
  const ledger = input.ledgerEntry;
  if (![input.forecast.contentDigestHex, input.canonicalVerification.contentDigestHex,
    input.accounting.contentDigestHex].every((value) => DIGEST.test(value)) ||
    !UUID.test(input.forecast.id) || !UUID.test(input.canonicalVerification.id) || !UUID.test(input.accounting.id) ||
    input.accounting.contentDigestHex !== ledger.accounting.frontierContentDigestHex) {
    throw new Error("HISTORICAL_SIMULATION_V2_PRODUCTION_REFUSED:CANONICAL_STAGE_IDENTITY");
  }
  const scope = { organizationId: ledger.organizationId, accountId: ledger.accountId, runId: ledger.runId,
    cycleId: ledger.cycleId, ledgerEntryContentDigestHex: ledger.contentDigestHex };
  const canonical = {
    FORECAST_LIFECYCLE: [{ artifactKind: "FORECAST_ISSUANCE" as const,
      artifactId: input.forecast.id, contentDigestHex: input.forecast.contentDigestHex }],
    CANONICAL_VERIFICATION: [{ artifactKind: "CANONICAL_VERIFICATION_RECEIPT" as const,
      artifactId: input.canonicalVerification.id, contentDigestHex: input.canonicalVerification.contentDigestHex }],
    ACCOUNTING: [{ artifactKind: "ACCOUNTING_FRONTIER" as const,
      artifactId: input.accounting.id, contentDigestHex: input.accounting.contentDigestHex }],
  };
  const modeled = Object.fromEntries(Object.entries(input.modeled).map(([stage, artifacts]) => [stage,
    artifacts.map((artifact) => ({ artifactKind: artifact.artifactKind, artifactId: artifact.artifactId,
      contentDigestHex: artifact.contentDigestHex, payload: artifact }))]));
  return Object.freeze(Object.fromEntries([
    ...Object.entries(canonical), ...Object.entries(modeled),
  ].map(([stage, artifacts]) => [stage, createHistoricalSimulationAtomicStageBundleV2({ ...scope,
    stage: stage as keyof HistoricalSimulationAtomicStageBundlesV2,
    artifacts: artifacts as never })])) as unknown as HistoricalSimulationAtomicStageBundlesV2);
}
