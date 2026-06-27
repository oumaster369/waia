import { PAPER_EVALUATION_EXPORT_SCHEMA_VERSION } from "@/lib/trader/paper/paper-evaluation-export.types";
import { computePaperEvaluationExportDigest } from "@/lib/trader/paper/serialize-paper-evaluation-export";
import { StrategyPromotionValidationError } from "@/lib/trader/validation-gate/strategy-promotion-record.errors";
import {
  buildPaperTradingEvidenceSlot,
  buildStrategyPromotionRecordPayload,
} from "@/lib/trader/validation-gate/serialize-strategy-promotion-record";
import type {
  AssembleStrategyPromotionRecordInput,
  StrategyPromotionRecordPayload,
} from "@/lib/trader/validation-gate/strategy-promotion-record.types";

function assertNonEmpty(value: string, code: string): void {
  if (value.trim().length === 0) {
    throw new StrategyPromotionValidationError(code);
  }
}

function assertConfidenceAttestation(
  attestation: AssembleStrategyPromotionRecordInput["confidenceAttestation"],
): void {
  assertNonEmpty(attestation.edgeNetOfCosts, "STRATEGY_PROMOTION_CONFIDENCE_EDGE_REQUIRED");
  assertNonEmpty(attestation.liveTracksPaper, "STRATEGY_PROMOTION_CONFIDENCE_TRACKING_REQUIRED");
  assertNonEmpty(
    attestation.downsideRiskBounded,
    "STRATEGY_PROMOTION_CONFIDENCE_DOWNSIDE_REQUIRED",
  );
}

function assertReasonCodeDistribution(distribution: Record<string, number>): void {
  if (Object.keys(distribution).length === 0) {
    throw new StrategyPromotionValidationError("STRATEGY_PROMOTION_REASON_CODES_REQUIRED");
  }
}

export function assembleStrategyPromotionRecord(
  input: AssembleStrategyPromotionRecordInput,
): StrategyPromotionRecordPayload {
  assertNonEmpty(input.gitCommitSha, "STRATEGY_PROMOTION_GIT_COMMIT_REQUIRED");
  assertNonEmpty(input.hypothesis, "STRATEGY_PROMOTION_HYPOTHESIS_REQUIRED");
  assertNonEmpty(input.intendedRegime, "STRATEGY_PROMOTION_REGIME_REQUIRED");
  assertConfidenceAttestation(input.confidenceAttestation);
  assertReasonCodeDistribution(input.reasonCodeDistribution);

  if (input.failureModes.length === 0) {
    throw new StrategyPromotionValidationError("STRATEGY_PROMOTION_FAILURE_MODES_REQUIRED");
  }

  const document = input.paperTradingEvidenceDocument;

  if (document.schemaVersion !== PAPER_EVALUATION_EXPORT_SCHEMA_VERSION) {
    throw new StrategyPromotionValidationError("STRATEGY_PROMOTION_EVIDENCE_SCHEMA_MISMATCH");
  }

  if (document.envelope.organizationId !== input.organizationId) {
    throw new StrategyPromotionValidationError("STRATEGY_PROMOTION_EVIDENCE_ORG_MISMATCH");
  }

  const executionMode = document.envelope.executionMode;
  if (executionMode !== "mock" && executionMode !== "paper") {
    throw new StrategyPromotionValidationError("STRATEGY_PROMOTION_EVIDENCE_MODE_INVALID");
  }

  if (document.evidenceBody.dataQuality.reconciliationStatus !== "clean") {
    throw new StrategyPromotionValidationError("STRATEGY_PROMOTION_EVIDENCE_RECONCILIATION_DIRTY");
  }

  const recomputedDigest = computePaperEvaluationExportDigest(document.evidenceBody);
  if (recomputedDigest !== document.envelope.contentDigest) {
    throw new StrategyPromotionValidationError("STRATEGY_PROMOTION_EVIDENCE_DIGEST_MISMATCH");
  }

  const paperTradingEvidence = buildPaperTradingEvidenceSlot(document);
  if (paperTradingEvidence.contentDigest !== document.envelope.contentDigest) {
    throw new StrategyPromotionValidationError("STRATEGY_PROMOTION_EVIDENCE_SLOT_DIGEST_MISMATCH");
  }

  return buildStrategyPromotionRecordPayload({
    organizationId: input.organizationId,
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    gitCommitSha: input.gitCommitSha,
    targetDeploymentState: "LIVE_LIMITED",
    hypothesis: input.hypothesis,
    intendedRegime: input.intendedRegime,
    costModel: input.costModel,
    failureModes: input.failureModes,
    reasonCodeDistribution: input.reasonCodeDistribution,
    paperTradingEvidence,
    confidenceAttestation: input.confidenceAttestation,
  });
}
