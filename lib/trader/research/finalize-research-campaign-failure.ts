import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { buildResearchRejectionRecord } from "@/lib/trader/research/build-research-rejection-record";
import type { ResearchPipelineRegimeFailureError } from "@/lib/trader/research/errors";
import type {
  CampaignOutcomeSnapshot,
  ResearchRejectionRecord,
} from "@/lib/trader/research/research-rejection-record.types";
import {
  getLatestCandidateForStrategyPostgres,
  updateStrategyCandidateStatusPostgres,
} from "@/lib/trader/research/strategy-candidate-repository-postgres";
import { parseResearchValidationMetricsJson } from "@/lib/trader/research/parse-research-validation-metrics";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export { parseResearchValidationMetricsJson };

type PgWriteExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update">;
type PgReadExecutor = Pick<WaiaPostgresDb, "select">;

export type FinalizeResearchCampaignFailureInput = {
  failure: ResearchPipelineRegimeFailureError;
  builderGitSha?: string | null;
};

export async function finalizeResearchCampaignFailurePostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  input: FinalizeResearchCampaignFailureInput,
): Promise<ResearchRejectionRecord> {
  const { failure } = input;

  const rejectionRecord = buildResearchRejectionRecord({
    organizationId: failure.organizationId,
    strategyId: failure.strategyId,
    strategyVersion: failure.strategyVersion,
    candidateId: failure.candidateId,
    datasetId: failure.datasetId,
    backtestRunId: failure.backtestRunId,
    blindValidationResultId: failure.blindValidationResultId,
    failureCode: "MULTI_REGIME_COVERAGE_INSUFFICIENT",
    failureMessage: failure.message,
    blindConsumed: failure.blindConsumed,
    walkForwardWindowCount: failure.walkForwardWindowCount,
    validationMetrics: failure.validationMetrics,
    walkForwardMetrics: failure.walkForwardMetrics,
    blindMetrics: failure.blindMetrics,
    builderGitSha: input.builderGitSha ?? null,
  });

  await updateStrategyCandidateStatusPostgres(ex, context, failure.candidateId, "rejected");

  return rejectionRecord;
}

export async function ingestCampaignOutcomeFromPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  input: { strategyId: string; strategyVersion: string },
): Promise<CampaignOutcomeSnapshot> {
  const candidate = await getLatestCandidateForStrategyPostgres(
    ex,
    context,
    input.strategyId,
    input.strategyVersion,
  );
  if (!candidate) {
    throw new Error(
      `[research] no strategy candidate found for ${input.strategyId}@${input.strategyVersion}`,
    );
  }

  if (candidate.status !== "rejected") {
    return {
      kind: "qualified",
      organizationId: candidate.organizationId,
      strategyId: candidate.strategyId,
      strategyVersion: candidate.strategyVersion,
      candidateId: candidate.id,
    };
  }

  return {
    kind: "rejected",
    organizationId: candidate.organizationId,
    strategyId: candidate.strategyId,
    strategyVersion: candidate.strategyVersion,
    candidateId: candidate.id,
  };
}

export function campaignOutcomeFromRejectionRecord(
  rejectionRecord: ResearchRejectionRecord,
): CampaignOutcomeSnapshot {
  const body = rejectionRecord.recordBody;
  return {
    kind: "rejected",
    organizationId: body.organizationId,
    strategyId: body.strategyId,
    strategyVersion: body.strategyVersion,
    candidateId: body.candidateId,
    rejectionRecord,
  };
}
