/**
 * In-memory WP13/WP14/WP21 repository bundle for HTR-WP21 same-run no-feedback proofs.
 * Implements real repository interfaces; used only through the production validation call graph.
 */

import type {
  CalibrationObservationRecord,
  CalibrationSnapshotRecord,
} from "@/lib/trader/intelligence/calibration/calibration.types";
import type { ForecastDecisionBundle } from "@/lib/trader/intelligence/forecast-decision/forecast-decision.types";
import type { ForecastDecisionBundleRepository } from "@/lib/trader/intelligence/forecast-decision/forecast-decision-repository-adapters";
import type { Wp21RuntimeDeps } from "@/lib/trader/intelligence/outcome-resolution/epistemic-closure-runtime";
import { OutcomeResolutionIdempotencyConflictError } from "@/lib/trader/intelligence/outcome-resolution/errors";
import type {
  AbstentionOutcomeRecord,
  ForecastOutcomeRecord,
  HypothesisOutcomeRecord,
  OutcomeResolutionSink,
  OutcomeResolutionSource,
} from "@/lib/trader/intelligence/outcome-resolution/outcome-resolution.types";
import type { IntelligenceCycleBundle } from "@/lib/trader/intelligence/records/intelligence-records.types";
import type { IntelligenceCycleBundleRepository } from "@/lib/trader/intelligence/records/repository-adapters";
import type { CalibrationSink } from "@/lib/trader/intelligence/calibration/calibration.types";
import type { OutcomeResolutionReadPort } from "@/lib/trader/knowledge/mkb-read-model.types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

function orgKey(context: OrgContext): string {
  return context.organizationId;
}

function assertIdempotent<T extends { contentDigest: string; id: string }>(
  existing: T,
  incoming: T,
): void {
  if (existing.contentDigest !== incoming.contentDigest || existing.id !== incoming.id) {
    throw new OutcomeResolutionIdempotencyConflictError("in-memory business key conflict");
  }
}

export type Wp21ProofInMemoryRuntime = Readonly<{
  intelligenceRecordsSink: IntelligenceCycleBundleRepository;
  forecastDecisionSink: ForecastDecisionBundleRepository;
  outcomeResolutionSink: OutcomeResolutionSink;
  calibrationSink: CalibrationSink;
  wp21RuntimeDeps: Wp21RuntimeDeps;
  epistemicRecordCount: () => number;
}>;

export function createWp21ProofInMemoryRuntime(): Wp21ProofInMemoryRuntime {
  const intelligenceBundles: IntelligenceCycleBundle[] = [];
  const forecastBundles: ForecastDecisionBundle[] = [];
  const forecastOutcomes: ForecastOutcomeRecord[] = [];
  const hypothesisOutcomes: HypothesisOutcomeRecord[] = [];
  const abstentionOutcomes: AbstentionOutcomeRecord[] = [];
  const calibrationObservations: CalibrationObservationRecord[] = [];
  const calibrationSnapshots: CalibrationSnapshotRecord[] = [];
  const confidenceUpdates: unknown[] = [];

  const intelligenceRecordsSink: IntelligenceCycleBundleRepository = {
    async persist(context, bundle) {
      intelligenceBundles.push(bundle);
      return bundle;
    },
  };

  const forecastDecisionSink: ForecastDecisionBundleRepository = {
    async persist(context, bundle) {
      forecastBundles.push(bundle);
      return bundle;
    },
  };

  const forecastOutcomeRepository = {
    async findByForecastRecordId(_context: OrgContext, forecastRecordId: string) {
      return forecastOutcomes.find((row) => row.forecastRecordId === forecastRecordId) ?? null;
    },
    async listForRun(_context: OrgContext, runId: string) {
      return forecastOutcomes.filter((row) => row.runId === runId);
    },
    async listUnresolvedForRun(context: OrgContext, runId: string) {
      return this.listForRun(context, runId);
    },
    async insert(_context: OrgContext, record: ForecastOutcomeRecord) {
      const existing = await this.findByForecastRecordId(_context, record.forecastRecordId);
      if (existing) {
        assertIdempotent(existing, record);
        return;
      }
      forecastOutcomes.push(record);
    },
  };

  const hypothesisOutcomeRepository = {
    async findByHypothesisRecordId(_context: OrgContext, hypothesisRecordId: string) {
      return (
        hypothesisOutcomes.find((row) => row.hypothesisRecordId === hypothesisRecordId) ?? null
      );
    },
    async listForRun(_context: OrgContext, runId: string) {
      return hypothesisOutcomes.filter((row) => row.runId === runId);
    },
    async insert(_context: OrgContext, record: HypothesisOutcomeRecord) {
      const existing = await this.findByHypothesisRecordId(_context, record.hypothesisRecordId);
      if (existing) {
        assertIdempotent(existing, record);
        return;
      }
      hypothesisOutcomes.push(record);
    },
  };

  const abstentionOutcomeRepository = {
    async findByDecisionRecordId(_context: OrgContext, decisionRecordId: string) {
      return abstentionOutcomes.find((row) => row.decisionRecordId === decisionRecordId) ?? null;
    },
    async listForRun(_context: OrgContext, runId: string) {
      return abstentionOutcomes.filter((row) => row.runId === runId);
    },
    async insert(_context: OrgContext, record: AbstentionOutcomeRecord) {
      const existing = await this.findByDecisionRecordId(_context, record.decisionRecordId);
      if (existing) {
        assertIdempotent(existing, record);
        return;
      }
      abstentionOutcomes.push(record);
    },
  };

  const outcomeResolutionSink: OutcomeResolutionSink = {
    forecastOutcomeRepository,
    hypothesisOutcomeRepository,
    abstentionOutcomeRepository,
  };

  const observationRepository = {
    async findByForecastOutcomeId(_context: OrgContext, forecastOutcomeId: string) {
      return (
        calibrationObservations.find((row) => row.forecastOutcomeId === forecastOutcomeId) ?? null
      );
    },
    async listForRun(_context: OrgContext, runId: string) {
      return calibrationObservations.filter((row) => row.runId === runId);
    },
    async insert(_context: OrgContext, record: CalibrationObservationRecord) {
      const existing = await this.findByForecastOutcomeId(_context, record.forecastOutcomeId);
      if (existing) {
        assertIdempotent(existing, record);
        return;
      }
      calibrationObservations.push(record);
    },
  };

  const snapshotRepository = {
    async findByPartition(
      _context: OrgContext,
      runId: string,
      partition: { forecastModelVersion: string; regime: string; horizon: string },
    ) {
      return (
        calibrationSnapshots.find(
          (row) =>
            row.runId === runId &&
            row.forecastModelVersion === partition.forecastModelVersion &&
            row.regime === partition.regime &&
            row.horizon === partition.horizon,
        ) ?? null
      );
    },
    async listForRun(_context: OrgContext, runId: string) {
      return calibrationSnapshots.filter((row) => row.runId === runId);
    },
    async insert(_context: OrgContext, record: CalibrationSnapshotRecord) {
      calibrationSnapshots.push(record);
    },
  };

  const calibrationSink: CalibrationSink = {
    observationRepository,
    snapshotRepository,
  };

  const source: OutcomeResolutionSource = {
    async listForecastsEligibleForResolution(context, runId, asOf) {
      const forecasts = forecastBundles.flatMap((bundle) => bundle.forecasts);
      const unresolved = [];
      for (const forecast of forecasts) {
        if (forecast.runId !== runId || forecast.organizationId !== orgKey(context)) {
          continue;
        }
        if (new Date(forecast.targetWindowEndAt).getTime() > new Date(asOf).getTime()) {
          continue;
        }
        const outcome = await forecastOutcomeRepository.findByForecastRecordId(
          context,
          forecast.id,
        );
        if (!outcome) {
          unresolved.push(forecast);
        }
      }
      return unresolved;
    },
    async listHypothesesEligibleForResolution(context, runId) {
      return intelligenceBundles.flatMap((bundle) =>
        bundle.hypotheses.filter(
          (row) => row.runId === runId && row.organizationId === orgKey(context),
        ),
      );
    },
    async listNoTradeDecisionsEligibleForScoring(context, runId, asOf) {
      return forecastBundles
        .map((bundle) => bundle.decision)
        .filter(
          (decision) =>
            decision.runId === runId &&
            decision.organizationId === orgKey(context) &&
            decision.decisionClass === "NO_TRADE" &&
            new Date(decision.issuedAt).getTime() <= new Date(asOf).getTime(),
        );
    },
    findForecastOutcomeByForecastId: (context, forecastRecordId) =>
      forecastOutcomeRepository.findByForecastRecordId(context, forecastRecordId),
    listForecastOutcomesForRun: (context, runId) =>
      forecastOutcomeRepository.listForRun(context, runId),
  };

  const outcomeResolutionReadPort: OutcomeResolutionReadPort = {
    async listResolvedOutcomes(context, asOf, query) {
      const rows = forecastOutcomes.filter(
        (row) =>
          row.organizationId === orgKey(context) &&
          row.outcomeClass === "RESOLVED" &&
          row.resolvedAt !== null &&
          new Date(row.resolvedAt).getTime() <= new Date(asOf).getTime() &&
          (query.runId ? row.runId === query.runId : true) &&
          (query.cycleId ? row.cycleId === query.cycleId : true) &&
          (query.symbol ? row.symbol === query.symbol : true) &&
          (row.outcomeVerdict === "CORRECT" || row.outcomeVerdict === "INCORRECT"),
      );
      return rows.map((row) => ({
        organizationId: row.organizationId,
        forecastRecordId: row.forecastRecordId,
        resolvedAt: row.resolvedAt!,
        verdict: row.outcomeVerdict as "CORRECT" | "INCORRECT",
      }));
    },
  };

  const wp21RuntimeDeps: Wp21RuntimeDeps = {
    outcomeResolutionSink,
    calibrationSink,
    confidenceUpdateSink: {
      confidenceUpdateRepository: {
        async findByIdempotencyKey() {
          return null;
        },
        async insert(_context: OrgContext, record: unknown) {
          confidenceUpdates.push(record);
        },
      },
    },
    outcomeResolutionReadPort,
    source,
  };

  return {
    intelligenceRecordsSink,
    forecastDecisionSink,
    outcomeResolutionSink,
    calibrationSink,
    wp21RuntimeDeps,
    epistemicRecordCount: () =>
      forecastOutcomes.length +
      hypothesisOutcomes.length +
      abstentionOutcomes.length +
      calibrationObservations.length +
      calibrationSnapshots.length +
      confidenceUpdates.length,
  };
}
