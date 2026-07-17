import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { Bar } from "@/lib/trader/intelligence/types";
import { createCalibrationObservationRepositoryPostgres } from "@/lib/trader/intelligence/calibration/calibration-observation-repository-postgres";
import { createCalibrationSnapshotRepositoryPostgres } from "@/lib/trader/intelligence/calibration/calibration-snapshot-repository-postgres";
import {
  buildCalibrationSnapshots,
  scoreForecastCalibrationObservation,
} from "@/lib/trader/intelligence/calibration/calibration-scorer";
import type { CalibrationSink } from "@/lib/trader/intelligence/calibration/calibration.types";
import { HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1_DIGEST } from "@/lib/trader/intelligence/historical-profile/htr-historical-intelligence-profile-v1";
import { createAbstentionOutcomeRepositoryPostgres } from "@/lib/trader/intelligence/outcome-resolution/abstention-outcome-repository-postgres";
import { createForecastOutcomeRepositoryPostgres } from "@/lib/trader/intelligence/outcome-resolution/forecast-outcome-repository-postgres";
import { createHypothesisOutcomeRepositoryPostgres } from "@/lib/trader/intelligence/outcome-resolution/hypothesis-outcome-repository-postgres";
import { createOutcomeResolutionSourcePostgres } from "@/lib/trader/intelligence/outcome-resolution/outcome-resolution-source-postgres";
import type {
  OutcomeProvenance,
  OutcomeResolutionSink,
  PitBarWindow,
} from "@/lib/trader/intelligence/outcome-resolution/outcome-resolution.types";
import { resolveEligibleForecastOutcomes } from "@/lib/trader/intelligence/outcome-resolution/resolve-forecast-outcome";
import { resolveEligibleHypothesisOutcomes } from "@/lib/trader/intelligence/outcome-resolution/resolve-hypothesis-outcome";
import { scoreAbstentionOutcomes } from "@/lib/trader/intelligence/outcome-resolution/score-abstention-outcome";
import {
  mergeWp21CheckpointState,
  type Wp21CheckpointState,
} from "@/lib/trader/intelligence/outcome-resolution/wp21-checkpoint-state";
import { createKnowledgeConfidenceUpdateRepositoryPostgres } from "@/lib/trader/knowledge/knowledge-confidence-update-repository-postgres";
import { queryMarketKnowledgeReadModel } from "@/lib/trader/knowledge/market-memory";
import { createOutcomeResolutionReadPortPostgres } from "@/lib/trader/knowledge/outcome-resolution-read-port-postgres";
import type { OutcomeResolutionReadPort } from "@/lib/trader/knowledge/mkb-read-model.types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

type PgExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "execute">;

export type Wp21RuntimeDeps = Readonly<{
  outcomeResolutionSink: OutcomeResolutionSink;
  calibrationSink: CalibrationSink;
  confidenceUpdateSink: {
    confidenceUpdateRepository: ReturnType<
      typeof createKnowledgeConfidenceUpdateRepositoryPostgres
    >;
  };
  outcomeResolutionReadPort: OutcomeResolutionReadPort;
  source: ReturnType<typeof createOutcomeResolutionSourcePostgres>;
}>;

export function createWp21RuntimeDepsPostgres(ex: PgExecutor): Wp21RuntimeDeps {
  return {
    outcomeResolutionSink: {
      forecastOutcomeRepository: createForecastOutcomeRepositoryPostgres(ex),
      hypothesisOutcomeRepository: createHypothesisOutcomeRepositoryPostgres(ex),
      abstentionOutcomeRepository: createAbstentionOutcomeRepositoryPostgres(ex),
    },
    calibrationSink: {
      observationRepository: createCalibrationObservationRepositoryPostgres(ex),
      snapshotRepository: createCalibrationSnapshotRepositoryPostgres(ex),
    },
    confidenceUpdateSink: {
      confidenceUpdateRepository: createKnowledgeConfidenceUpdateRepositoryPostgres(ex),
    },
    outcomeResolutionReadPort: createOutcomeResolutionReadPortPostgres(ex),
    source: createOutcomeResolutionSourcePostgres(ex),
  };
}

export type RunWp21CycleSeamInput = Readonly<{
  context: OrgContext;
  runId: string;
  asOf: string;
  bars: readonly Bar[];
  deps: Wp21RuntimeDeps;
  provenance: OutcomeProvenance;
  checkpoint?: Wp21CheckpointState;
  codeSha: string;
  datasetContentDigest: string;
}>;

export type RunWp21CycleSeamResult = Readonly<{
  forecastOutcomes: readonly import("@/lib/trader/intelligence/outcome-resolution/outcome-resolution.types").ForecastOutcomeRecord[];
  hypothesisOutcomes: readonly import("@/lib/trader/intelligence/outcome-resolution/outcome-resolution.types").HypothesisOutcomeRecord[];
  abstentionOutcomes: readonly import("@/lib/trader/intelligence/outcome-resolution/outcome-resolution.types").AbstentionOutcomeRecord[];
  checkpoint: Wp21CheckpointState;
}>;

export async function runWp21CycleSeam(
  input: RunWp21CycleSeamInput,
): Promise<RunWp21CycleSeamResult> {
  const pitWindow: PitBarWindow = {
    bars: input.bars,
    asOf: input.asOf,
    evidenceCutoffAt: input.asOf,
  };

  const forecastOutcomes = await resolveEligibleForecastOutcomes({
    context: input.context,
    runId: input.runId,
    asOf: input.asOf,
    pitWindow,
    source: input.deps.source,
    sink: input.deps.outcomeResolutionSink,
    provenance: input.provenance,
  });

  const hypothesisOutcomes = await resolveEligibleHypothesisOutcomes({
    context: input.context,
    runId: input.runId,
    asOf: input.asOf,
    source: input.deps.source,
    sink: input.deps.outcomeResolutionSink,
    provenance: input.provenance,
  });

  const abstentionOutcomes = await scoreAbstentionOutcomes({
    context: input.context,
    runId: input.runId,
    asOf: input.asOf,
    pitWindow,
    source: input.deps.source,
    sink: input.deps.outcomeResolutionSink,
    provenance: input.provenance,
  });

  const checkpoint = mergeWp21CheckpointState(input.checkpoint, {
    resolvedForecastOutcomeIds: forecastOutcomes.map((row) => row.id),
    resolvedHypothesisOutcomeIds: hypothesisOutcomes.map((row) => row.id),
    processedAbstentionDecisionIds: abstentionOutcomes.map((row) => row.decisionRecordId),
    lastEligibleResolutionTime: input.asOf,
  });

  return { forecastOutcomes, hypothesisOutcomes, abstentionOutcomes, checkpoint };
}

export type RunWp21TerminalSeamInput = Readonly<{
  context: OrgContext;
  runId: string;
  asOf: string;
  deps: Wp21RuntimeDeps;
  provenance: OutcomeProvenance;
  ex: PgExecutor;
  checkpoint?: Wp21CheckpointState;
}>;

export type RunWp21TerminalSeamResult = Readonly<{
  calibrationSnapshotCount: number;
  mkbQueryExecuted: boolean;
  checkpoint: Wp21CheckpointState;
}>;

export async function runWp21TerminalSeam(
  input: RunWp21TerminalSeamInput,
): Promise<RunWp21TerminalSeamResult> {
  const outcomes =
    await input.deps.outcomeResolutionSink.forecastOutcomeRepository.listUnresolvedForRun(
      input.context,
      input.runId,
    );

  const forecasts = await input.deps.source.listForecastsEligibleForResolution(
    input.context,
    input.runId,
    input.asOf,
  );

  const observations = [];
  for (const outcome of outcomes) {
    const existing = await input.deps.calibrationSink.observationRepository.findByForecastOutcomeId(
      input.context,
      outcome.id,
    );
    if (existing) {
      observations.push(existing);
      continue;
    }

    const forecast = forecasts.find((row) => row.id === outcome.forecastRecordId);
    if (!forecast) {
      const allForecasts = await input.deps.source.listForecastsEligibleForResolution(
        input.context,
        input.runId,
        "9999-12-31T23:59:59.999Z",
      );
      const matched = allForecasts.find((row) => row.id === outcome.forecastRecordId);
      if (!matched) {
        continue;
      }
      const observation = scoreForecastCalibrationObservation({
        context: input.context,
        forecast: matched,
        outcome,
        provenance: input.provenance,
      });
      await input.deps.calibrationSink.observationRepository.insert(input.context, observation);
      observations.push(observation);
      continue;
    }

    const observation = scoreForecastCalibrationObservation({
      context: input.context,
      forecast,
      outcome,
      provenance: input.provenance,
    });
    await input.deps.calibrationSink.observationRepository.insert(input.context, observation);
    observations.push(observation);
  }

  const allObservations = await input.deps.calibrationSink.observationRepository.listForRun(
    input.context,
    input.runId,
  );
  const snapshots = buildCalibrationSnapshots({
    context: input.context,
    runId: input.runId,
    asOf: input.asOf,
    observations: allObservations.length > 0 ? allObservations : observations,
    provenance: input.provenance,
  });

  for (const snapshot of snapshots) {
    await input.deps.calibrationSink.snapshotRepository.insert(input.context, snapshot);
  }

  await queryMarketKnowledgeReadModel(
    input.ex,
    input.context,
    { runId: input.runId },
    new Date(input.asOf),
    input.deps.outcomeResolutionReadPort,
  );

  const checkpoint = mergeWp21CheckpointState(input.checkpoint, {
    wp21SemanticDigests: {
      terminal_calibration: snapshots[0]?.contentDigest ?? "",
    },
  });

  return {
    calibrationSnapshotCount: snapshots.length,
    mkbQueryExecuted: true,
    checkpoint,
  };
}

export function buildDefaultWp21Provenance(input: {
  codeSha: string;
  datasetContentDigest: string;
}): OutcomeProvenance {
  return {
    codeSha: input.codeSha,
    datasetContentDigest: input.datasetContentDigest,
    profileDigest: HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1_DIGEST,
    canonicalizer: "HTR_SEMANTIC_CANONICAL_JSON_V1",
  };
}
