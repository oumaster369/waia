import { createHash } from "node:crypto";

import type { PaperEvaluationExportDocument } from "@/lib/trader/paper/paper-evaluation-export.types";
import {
  canonicalJsonString,
  computePaperEvaluationExportDigest,
} from "@/lib/trader/paper/serialize-paper-evaluation-export";
import type { ResearchEvidenceSlot } from "@/lib/trader/research/research-evidence-export.types";
import {
  buildResearchEvidenceSlot,
  computeResearchEvidenceExportDigest,
} from "@/lib/trader/research/serialize-research-evidence-export";
import {
  STRATEGY_PROMOTION_RECORD_SCHEMA_VERSION,
  type ConfidenceAttestation,
  type PaperEvaluationEvidenceSlot,
  type PromotionCostModel,
  type StrategyPromotionRecordPayload,
} from "@/lib/trader/validation-gate/strategy-promotion-record.types";

export type StrategyPromotionRecordDigestInput = {
  organizationId: string;
  strategyId: string;
  strategyVersion: string;
  gitCommitSha: string;
  targetDeploymentState: "LIVE_LIMITED";
  hypothesis: string;
  intendedRegime: string;
  costModel: PromotionCostModel;
  failureModes: string[];
  reasonCodeDistribution: Record<string, number>;
  paperTradingEvidence: PaperEvaluationEvidenceSlot;
  researchEvidence?: ResearchEvidenceSlot;
  confidenceAttestation: ConfidenceAttestation;
};

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortKeysDeep(entry));
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort((a, b) => a.localeCompare(b))
        .map((key) => [key, sortKeysDeep(record[key])]),
    );
  }
  return value;
}

export function canonicalizeStrategyPromotionDigestInput(
  input: StrategyPromotionRecordDigestInput,
): StrategyPromotionRecordDigestInput {
  return sortKeysDeep({
    ...input,
    failureModes: [...input.failureModes].sort((a, b) => a.localeCompare(b)),
    reasonCodeDistribution: Object.fromEntries(
      Object.entries(input.reasonCodeDistribution).sort(([a], [b]) => a.localeCompare(b)),
    ),
    paperTradingEvidence: {
      artifactSchemaVersion: input.paperTradingEvidence.artifactSchemaVersion,
      contentDigest: input.paperTradingEvidence.contentDigest,
      document: sortKeysDeep(input.paperTradingEvidence.document),
    },
    ...(input.researchEvidence
      ? {
          researchEvidence: {
            artifactSchemaVersion: input.researchEvidence.artifactSchemaVersion,
            contentDigest: input.researchEvidence.contentDigest,
            document: sortKeysDeep(input.researchEvidence.document),
          },
        }
      : {}),
  }) as StrategyPromotionRecordDigestInput;
}

export function computeStrategyPromotionRecordDigest(
  input: StrategyPromotionRecordDigestInput,
): string {
  const canonical = canonicalizeStrategyPromotionDigestInput(input);
  return createHash("sha256").update(canonicalJsonString(canonical), "utf8").digest("hex");
}

export function buildResearchEvidenceSlotFromDocument(
  document: import("@/lib/trader/research/research-evidence-export.types").ResearchEvidenceDocument,
): ResearchEvidenceSlot {
  return buildResearchEvidenceSlot(document);
}

export { computeResearchEvidenceExportDigest };

export function buildPaperTradingEvidenceSlot(
  document: PaperEvaluationExportDocument,
): PaperEvaluationEvidenceSlot {
  const contentDigest = computePaperEvaluationExportDigest(document.evidenceBody);
  return {
    artifactSchemaVersion: document.schemaVersion,
    contentDigest,
    document,
  };
}

export function buildStrategyPromotionRecordPayload(
  input: StrategyPromotionRecordDigestInput,
): StrategyPromotionRecordPayload {
  const recordContentDigest = computeStrategyPromotionRecordDigest(input);
  return {
    schemaVersion: STRATEGY_PROMOTION_RECORD_SCHEMA_VERSION,
    organizationId: input.organizationId,
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    gitCommitSha: input.gitCommitSha,
    targetDeploymentState: input.targetDeploymentState,
    hypothesis: input.hypothesis,
    intendedRegime: input.intendedRegime,
    costModel: input.costModel,
    failureModes: input.failureModes,
    reasonCodeDistribution: input.reasonCodeDistribution,
    paperTradingEvidence: input.paperTradingEvidence,
    ...(input.researchEvidence ? { researchEvidence: input.researchEvidence } : {}),
    confidenceAttestation: input.confidenceAttestation,
    recordContentDigest,
  };
}
