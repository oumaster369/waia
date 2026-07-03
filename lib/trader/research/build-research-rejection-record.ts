import type { MultiRegimeCoverageReport } from "@/lib/trader/research/regime-coverage";
import {
  collectRegimeLabelsFromMetrics,
  evaluateMultiRegimeCoverage,
} from "@/lib/trader/research/regime-coverage";
import type {
  RejectionMissingBucket,
  ResearchRejectionFailureCode,
  ResearchRejectionRecord,
  ResearchRejectionRecordBody,
} from "@/lib/trader/research/research-rejection-record.types";
import { RESEARCH_REJECTION_RECORD_SCHEMA_VERSION } from "@/lib/trader/research/research-rejection-record.types";
import { computeResearchRejectionRecordDigest } from "@/lib/trader/research/serialize-research-rejection-record";
import type { ResearchValidationMetrics } from "@/lib/trader/research/strategy-candidate.types";

export type BuildResearchRejectionRecordInput = {
  organizationId: string;
  strategyId: string;
  strategyVersion: string;
  candidateId: string;
  datasetId: string;
  backtestRunId: string;
  blindValidationResultId: string;
  failureCode: ResearchRejectionFailureCode;
  failureMessage: string;
  blindConsumed: boolean;
  walkForwardWindowCount: number;
  validationMetrics: ResearchValidationMetrics;
  walkForwardMetrics: readonly ResearchValidationMetrics[];
  blindMetrics: ResearchValidationMetrics;
  builderGitSha?: string | null;
  rejectedAt?: string;
};

function resolveMissingBuckets(report: MultiRegimeCoverageReport): RejectionMissingBucket[] {
  const missing: RejectionMissingBucket[] = [];
  if (!report.hasNonTrending) {
    missing.push("non_trending");
  }
  if (!report.hasDown) {
    missing.push("down_regime");
  }
  return missing;
}

export function buildResearchRejectionRecordBody(
  input: BuildResearchRejectionRecordInput,
): ResearchRejectionRecordBody {
  const allMetrics = [input.validationMetrics, ...input.walkForwardMetrics, input.blindMetrics];
  const observedRegimes = collectRegimeLabelsFromMetrics(allMetrics);
  const bundleRegimeCoverage = evaluateMultiRegimeCoverage(observedRegimes);

  return {
    organizationId: input.organizationId,
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    candidateId: input.candidateId,
    datasetId: input.datasetId,
    backtestRunId: input.backtestRunId,
    blindValidationResultId: input.blindValidationResultId,
    failureCode: input.failureCode,
    failureMessage: input.failureMessage,
    blindConsumed: input.blindConsumed,
    walkForwardWindowCount: input.walkForwardWindowCount,
    validationMetrics: input.validationMetrics,
    blindMetrics: input.blindMetrics,
    bundleRegimeCoverage,
    observedRegimes,
    missingBuckets: resolveMissingBuckets(bundleRegimeCoverage),
    builderGitSha: input.builderGitSha ?? null,
    rejectedAt: input.rejectedAt ?? new Date().toISOString(),
  };
}

export function buildResearchRejectionRecord(
  input: BuildResearchRejectionRecordInput,
): ResearchRejectionRecord {
  const recordBody = buildResearchRejectionRecordBody(input);
  const contentDigest = computeResearchRejectionRecordDigest(recordBody);

  return {
    schemaVersion: RESEARCH_REJECTION_RECORD_SCHEMA_VERSION,
    envelope: { contentDigest },
    recordBody,
  };
}
