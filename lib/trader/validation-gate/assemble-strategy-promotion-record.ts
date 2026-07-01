import { PAPER_EVALUATION_EXPORT_SCHEMA_VERSION } from "@/lib/trader/paper/paper-evaluation-export.types";
import { computePaperEvaluationExportDigest } from "@/lib/trader/paper/serialize-paper-evaluation-export";
import { RESEARCH_EVIDENCE_EXPORT_SCHEMA_VERSION } from "@/lib/trader/research/research-evidence-export.types";
import {
  buildResearchEvidenceSlot,
  computeResearchEvidenceExportDigest,
  hasSufficientResearchRegimeCoverage,
} from "@/lib/trader/research/serialize-research-evidence-export";
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

function assertResearchEvidenceDocument(
  input: AssembleStrategyPromotionRecordInput,
): ReturnType<typeof buildResearchEvidenceSlot> | undefined {
  const document = input.researchEvidenceDocument;
  if (!document) {
    return undefined;
  }

  if (document.schemaVersion !== RESEARCH_EVIDENCE_EXPORT_SCHEMA_VERSION) {
    throw new StrategyPromotionValidationError(
      "STRATEGY_PROMOTION_RESEARCH_EVIDENCE_SCHEMA_MISMATCH",
    );
  }

  if (document.envelope.organizationId !== input.organizationId) {
    throw new StrategyPromotionValidationError("STRATEGY_PROMOTION_RESEARCH_EVIDENCE_ORG_MISMATCH");
  }

  if (document.envelope.strategyId !== input.strategyId) {
    throw new StrategyPromotionValidationError(
      "STRATEGY_PROMOTION_RESEARCH_EVIDENCE_STRATEGY_MISMATCH",
    );
  }

  if (document.envelope.strategyVersion !== input.strategyVersion) {
    throw new StrategyPromotionValidationError(
      "STRATEGY_PROMOTION_RESEARCH_EVIDENCE_VERSION_MISMATCH",
    );
  }

  if (document.evidenceBody.executionMode !== "backtest") {
    throw new StrategyPromotionValidationError("STRATEGY_PROMOTION_RESEARCH_EVIDENCE_MODE_INVALID");
  }

  const recomputedDigest = computeResearchEvidenceExportDigest(document.evidenceBody);
  if (recomputedDigest !== document.envelope.contentDigest) {
    throw new StrategyPromotionValidationError(
      "STRATEGY_PROMOTION_RESEARCH_EVIDENCE_DIGEST_MISMATCH",
    );
  }

  if (!hasSufficientResearchRegimeCoverage(document.evidenceBody.regimeCoverage)) {
    throw new StrategyPromotionValidationError(
      "STRATEGY_PROMOTION_RESEARCH_REGIME_COVERAGE_INSUFFICIENT",
    );
  }

  const researchEvidence = buildResearchEvidenceSlot(document);
  if (researchEvidence.contentDigest !== document.envelope.contentDigest) {
    throw new StrategyPromotionValidationError(
      "STRATEGY_PROMOTION_RESEARCH_EVIDENCE_SLOT_DIGEST_MISMATCH",
    );
  }

  return researchEvidence;
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

  if (executionMode === "mock" && !input.researchEvidenceDocument) {
    throw new StrategyPromotionValidationError("STRATEGY_PROMOTION_MOCK_EVIDENCE_INSUFFICIENT");
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

  const researchEvidence = assertResearchEvidenceDocument(input);

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
    ...(researchEvidence ? { researchEvidence } : {}),
    confidenceAttestation: input.confidenceAttestation,
  });
}
