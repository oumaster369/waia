import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { BarInterval, InstrumentId } from "@/lib/trader/intelligence/types";
import { listMarketBarsPostgres } from "@/lib/trader/market-data/market-bars-repository-postgres";
import { buildEvolutionCycleMvp } from "@/lib/trader/research/build-evolution-cycle-mvp";
import { buildResearchRejectionRecord } from "@/lib/trader/research/build-research-rejection-record";
import {
  MultiRegimeCoverageError,
  ResearchFailureReconstructionError,
} from "@/lib/trader/research/errors";
import { loadResearchFailureReconstructionContextPostgres } from "@/lib/trader/research/load-research-failure-reconstruction-context";
import { rederiveValidationMetricsFromSealedDataset } from "@/lib/trader/research/rederive-validation-metrics-from-sealed-dataset";
import type {
  ReconstructResearchFailureArtifactsResult,
  ResearchFailureReconstructionContext,
} from "@/lib/trader/research/research-failure-reconstruction.types";
import { assertResearchPipelineRegimeCoverage } from "@/lib/trader/research/regime-coverage";
import { updateStrategyCandidateStatusPostgres } from "@/lib/trader/research/strategy-candidate-repository-postgres";
import type { ResearchValidationMetrics } from "@/lib/trader/research/strategy-candidate.types";
import { verifySealedResearchDatasetFromBars } from "@/lib/trader/research/verify-sealed-research-dataset";
import {
  writeCampaignFailureVaultArtifacts,
  type VaultArtifactNaming,
} from "@/lib/trader/research/write-campaign-failure-vault";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

type PgExecutor = Pick<WaiaPostgresDb, "select" | "update">;

export type BuildRejectionArtifactsFromContextInput = {
  context: ResearchFailureReconstructionContext;
  validationMetrics: ResearchValidationMetrics;
  builderGitSha?: string | null;
};

export function buildRejectionArtifactsFromContext(
  input: BuildRejectionArtifactsFromContextInput,
): {
  rejectionRecord: ReturnType<typeof buildResearchRejectionRecord>;
  evolutionCycle: ReturnType<typeof buildEvolutionCycleMvp>;
  failureMessage: string;
} {
  const { context, validationMetrics } = input;
  const pipelineMetrics = [validationMetrics, ...context.walkForwardMetrics, context.blindMetrics];

  let failureMessage: string;
  try {
    assertResearchPipelineRegimeCoverage(pipelineMetrics);
    throw new ResearchFailureReconstructionError(
      "REGIME_COVERAGE_NOT_FAILED",
      "bundle regime coverage satisfies requirement — not a rejection scenario",
    );
  } catch (error) {
    if (error instanceof ResearchFailureReconstructionError) {
      throw error;
    }
    if (!(error instanceof MultiRegimeCoverageError)) {
      throw error;
    }
    failureMessage = error.message;
  }

  const rejectionRecord = buildResearchRejectionRecord({
    organizationId: context.candidate.organizationId,
    strategyId: context.candidate.strategyId,
    strategyVersion: context.candidate.strategyVersion,
    candidateId: context.candidate.id,
    datasetId: context.dataset.id,
    backtestRunId: context.validationBacktestRun.id,
    blindValidationResultId: context.blindResult.id,
    failureCode: "MULTI_REGIME_COVERAGE_INSUFFICIENT",
    failureMessage,
    blindConsumed: context.candidate.blindUsed,
    walkForwardWindowCount: context.walkForwardWindows.length,
    validationMetrics,
    walkForwardMetrics: context.walkForwardMetrics,
    blindMetrics: context.blindMetrics,
    builderGitSha: input.builderGitSha ?? null,
  });

  const evolutionCycle = buildEvolutionCycleMvp({ rejectionRecord });

  return { rejectionRecord, evolutionCycle, failureMessage };
}

export type ReconstructResearchFailureArtifactsInput = {
  candidateId: string;
  vaultDir: string;
  symbol?: InstrumentId;
  interval?: BarInterval;
  finalize?: boolean;
  builderGitSha?: string | null;
  vaultNaming?: VaultArtifactNaming;
  trackId?: "A" | "B";
};

export async function reconstructResearchFailureArtifactsPostgres(
  ex: PgExecutor,
  context: OrgContext,
  input: ReconstructResearchFailureArtifactsInput,
): Promise<ReconstructResearchFailureArtifactsResult> {
  const loaded = await loadResearchFailureReconstructionContextPostgres(
    ex,
    context,
    input.candidateId,
  );

  const symbol = input.symbol ?? loaded.dataset.symbol;
  const interval = input.interval ?? loaded.dataset.interval;

  const barRecords = await listMarketBarsPostgres(ex, context, { symbol, interval });
  const bars = barRecords.map((record) => ({
    symbol: record.symbol,
    interval: record.interval,
    open: record.open,
    high: record.high,
    low: record.low,
    close: record.close,
    volume: record.volume,
    barOpenTime: record.barOpenTime,
    barCloseTime: record.barCloseTime,
  }));

  const verified = verifySealedResearchDatasetFromBars(bars, loaded.dataset);

  const validationMetrics = await rederiveValidationMetricsFromSealedDataset({
    context,
    validationBars: verified.splits.validation,
    strategyId: loaded.candidate.strategyId,
    strategyVersion: loaded.candidate.strategyVersion,
    datasetId: loaded.dataset.id,
    backtestRunId: loaded.validationBacktestRun.id,
    costModelVersion: loaded.validationBacktestRun.costModelVersion,
  });

  const { rejectionRecord, evolutionCycle } = buildRejectionArtifactsFromContext({
    context: loaded,
    validationMetrics,
    builderGitSha: input.builderGitSha,
  });

  let finalized = false;
  if (input.finalize && loaded.candidate.status === "blind_validated") {
    await updateStrategyCandidateStatusPostgres(ex, context, loaded.candidate.id, "rejected");
    finalized = true;
  }

  const artifactPaths = writeCampaignFailureVaultArtifacts({
    vaultDir: input.vaultDir,
    trackId: input.trackId ?? "A",
    naming: input.vaultNaming ?? "flat",
    rejectionRecord,
    evolutionCycle,
  });

  return {
    rejectionRecord,
    evolutionCycle,
    rejectionRecordPath: artifactPaths.rejectionRecordPath,
    evolutionCyclePath: artifactPaths.evolutionCyclePath,
    validationMetricsSource: "sealed_dataset_replay",
    finalized,
  };
}
