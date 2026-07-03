import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { getValidationBacktestRunForDatasetPostgres } from "@/lib/trader/backtest/backtest-repository-postgres";
import { getResearchDatasetByIdPostgres } from "@/lib/trader/market-data/research-dataset-repository-postgres";
import {
  ResearchFailureReconstructionError,
  StrategyCandidateNotFoundError,
} from "@/lib/trader/research/errors";
import { parseResearchValidationMetricsJson } from "@/lib/trader/research/parse-research-validation-metrics";
import type { ResearchFailureReconstructionContext } from "@/lib/trader/research/research-failure-reconstruction.types";
import {
  getBlindValidationResultForCandidatePostgres,
  getStrategyCandidateByIdPostgres,
  listWalkForwardWindowsForCandidatePostgres,
} from "@/lib/trader/research/strategy-candidate-repository-postgres";
import type { StrategyCandidateStatus } from "@/lib/trader/research/strategy-candidate.types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

type PgReadExecutor = Pick<WaiaPostgresDb, "select">;

const ELIGIBLE_STATUSES = new Set<StrategyCandidateStatus>(["blind_validated", "rejected"]);

export async function loadResearchFailureReconstructionContextPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  candidateId: string,
): Promise<ResearchFailureReconstructionContext> {
  const candidate = await getStrategyCandidateByIdPostgres(ex, context, candidateId);
  if (!candidate) {
    throw new StrategyCandidateNotFoundError(candidateId);
  }

  if (!candidate.blindUsed) {
    throw new ResearchFailureReconstructionError(
      "CANDIDATE_NOT_ELIGIBLE",
      `candidate ${candidateId} has blind_used=false`,
    );
  }

  if (!ELIGIBLE_STATUSES.has(candidate.status)) {
    throw new ResearchFailureReconstructionError(
      "CANDIDATE_NOT_ELIGIBLE",
      `candidate ${candidateId} status ${candidate.status} is not eligible for failure reconstruction`,
    );
  }

  const blindResult = await getBlindValidationResultForCandidatePostgres(ex, context, candidateId);
  if (!blindResult) {
    throw new ResearchFailureReconstructionError(
      "BLIND_RESULT_NOT_FOUND",
      `no blind validation result for candidate ${candidateId}`,
    );
  }

  const walkForwardWindows = await listWalkForwardWindowsForCandidatePostgres(
    ex,
    context,
    candidateId,
  );
  if (walkForwardWindows.length === 0) {
    throw new ResearchFailureReconstructionError(
      "WALK_FORWARD_WINDOWS_EMPTY",
      `candidate ${candidateId} has no walk-forward windows`,
    );
  }

  const dataset = await getResearchDatasetByIdPostgres(ex, context, blindResult.datasetId);
  if (!dataset) {
    throw new ResearchFailureReconstructionError(
      "SEALED_DATASET_NOT_FOUND",
      `research dataset ${blindResult.datasetId} not found`,
    );
  }

  const validationBacktestRun = await getValidationBacktestRunForDatasetPostgres(
    ex,
    context,
    blindResult.datasetId,
  );
  if (!validationBacktestRun) {
    throw new ResearchFailureReconstructionError(
      "VALIDATION_BACKTEST_RUN_NOT_FOUND",
      `no validation backtest run for dataset ${blindResult.datasetId}`,
    );
  }

  if (
    validationBacktestRun.strategyId !== candidate.strategyId ||
    validationBacktestRun.strategyVersion !== candidate.strategyVersion
  ) {
    throw new ResearchFailureReconstructionError(
      "CANDIDATE_NOT_ELIGIBLE",
      "validation backtest run strategy does not match candidate",
    );
  }

  return {
    candidate,
    blindResult,
    walkForwardWindows,
    walkForwardMetrics: walkForwardWindows.map((window) =>
      parseResearchValidationMetricsJson(window.metricsJson),
    ),
    blindMetrics: parseResearchValidationMetricsJson(blindResult.metricsJson),
    dataset,
    validationBacktestRun,
  };
}
