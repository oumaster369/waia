import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type {
  AssembleReasoningContextInput,
  ReasoningContext,
} from "@/lib/trader/research/reasoning-context.types";
import { REASONING_CONTEXT_SCHEMA_VERSION } from "@/lib/trader/research/reasoning-context.types";
import { computeReasoningContextDigest } from "@/lib/trader/research/serialize-reasoning-context";
import type { EvolutionCycleMvp } from "@/lib/trader/research/evolution-cycle-mvp.types";
import type { ResearchRejectionRecord } from "@/lib/trader/research/research-rejection-record.types";
import { ResearchFailureReconstructionError } from "@/lib/trader/research/errors";

export function verifyArtifactContentDigest<T>(
  label: string,
  artifact: { envelope: { contentDigest: string } },
  computeDigest: (body: T) => string,
  body: T,
): void {
  const expected = artifact.envelope.contentDigest;
  const actual = computeDigest(body);
  if (expected !== actual) {
    throw new ResearchFailureReconstructionError(
      "ARTIFACT_DIGEST_MISMATCH",
      `${label} contentDigest mismatch: expected ${expected}, computed ${actual}`,
    );
  }
}

export function assembleReasoningContext(input: AssembleReasoningContextInput): ReasoningContext {
  const { rejectionRecord, evolutionCycle } = input;
  const rejectionBody = rejectionRecord.recordBody;
  const evolutionBody = evolutionCycle.cycleBody;

  if (evolutionCycle.envelope.sourceRejectionDigest !== rejectionRecord.envelope.contentDigest) {
    throw new ResearchFailureReconstructionError(
      "EVOLUTION_REJECTION_DIGEST_MISMATCH",
      "evolution cycle sourceRejectionDigest does not match rejection record digest",
    );
  }

  const contextBody = {
    rejectionRecord,
    evolutionCycle,
    validationMetrics: rejectionBody.validationMetrics,
    walkForwardSummary: {
      windowCount: rejectionBody.walkForwardWindowCount,
      availability: "loaded" as const,
    },
    blindValidationSummary: {
      blindConsumed: rejectionBody.blindConsumed,
      blindMetrics: rejectionBody.blindMetrics,
      availability: "loaded" as const,
    },
    strategyMetadata: {
      strategyId: rejectionBody.strategyId,
      strategyVersion: rejectionBody.strategyVersion,
      availability: "loaded" as const,
    },
    candidateLineage: {
      candidateId: rejectionBody.candidateId,
      priorStrategyId: evolutionBody.hypothesisProposal.lineage.priorStrategyId,
      priorStrategyVersion: evolutionBody.hypothesisProposal.lineage.priorStrategyVersion,
      availability: "loaded" as const,
    },
    previousRejections: [] as const,
    previousHypotheses: [] as const,
    knowledgeNeeds: [evolutionBody.knowledgeNeed],
    researchQuestions: [evolutionBody.researchQuestion],
    productionKnowledgeAssets: [] as const,
    marketKnowledge: [] as const,
    marketStatistics: null,
    chartSnapshots: [] as const,
  };

  const contentDigest = computeReasoningContextDigest(contextBody);
  const assembledAt = input.assembledAt ?? new Date().toISOString();

  return {
    schemaVersion: REASONING_CONTEXT_SCHEMA_VERSION,
    envelope: {
      organizationId: rejectionBody.organizationId,
      strategyId: rejectionBody.strategyId,
      strategyVersion: rejectionBody.strategyVersion,
      candidateId: rejectionBody.candidateId,
      reasoningSessionId: input.reasoningSessionId,
      assembledAt,
      contentDigest,
      sourceArtifactDigests: {
        rejectionRecord: rejectionRecord.envelope.contentDigest,
        evolutionCycle: evolutionCycle.envelope.contentDigest,
      },
    },
    contextBody,
  };
}

export type LoadVaultArtifactsResult = {
  rejectionRecord: ResearchRejectionRecord;
  evolutionCycle: EvolutionCycleMvp;
};

export function parseVaultRejectionRecord(raw: unknown): ResearchRejectionRecord {
  if (raw === null || typeof raw !== "object") {
    throw new ResearchFailureReconstructionError(
      "VAULT_PARSE_ERROR",
      "invalid rejection record JSON",
    );
  }
  const record = raw as ResearchRejectionRecord;
  if (record.schemaVersion !== "waia.trader.research-rejection-record.v1") {
    throw new ResearchFailureReconstructionError(
      "VAULT_PARSE_ERROR",
      `unsupported rejection record schema: ${String(record.schemaVersion)}`,
    );
  }
  return record;
}

export function parseVaultEvolutionCycle(raw: unknown): EvolutionCycleMvp {
  if (raw === null || typeof raw !== "object") {
    throw new ResearchFailureReconstructionError(
      "VAULT_PARSE_ERROR",
      "invalid evolution cycle JSON",
    );
  }
  const cycle = raw as EvolutionCycleMvp;
  if (cycle.schemaVersion !== "waia.trader.evolution-cycle-mvp.v1") {
    throw new ResearchFailureReconstructionError(
      "VAULT_PARSE_ERROR",
      `unsupported evolution cycle schema: ${String(cycle.schemaVersion)}`,
    );
  }
  return cycle;
}
