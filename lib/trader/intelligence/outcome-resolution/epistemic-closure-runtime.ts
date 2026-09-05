import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type postgres from "postgres";
import { runWaiaPostgresTransaction } from "@/db/waia-postgres-transaction";
import { withPostgresSessionTransaction } from "@/db/postgres-session-transaction";
import type { Bar } from "@/lib/trader/intelligence/types";
import { normalizeSymbolForHistoricalExecution } from "@/lib/trader/backtest/historical-execution-profile";
import { createCalibrationObservationRepositoryPostgres } from "@/lib/trader/intelligence/calibration/calibration-observation-repository-postgres";
import { createCalibrationSnapshotRepositoryPostgres } from "@/lib/trader/intelligence/calibration/calibration-snapshot-repository-postgres";
import {
  buildCalibrationSnapshots,
  scoreForecastV2MulticlassObservation,
  scoreForecastCalibrationObservation,
} from "@/lib/trader/intelligence/calibration/calibration-scorer";
import type { ForecastV2ObjectiveEvidence } from "@/lib/trader/intelligence/calibration/calibration-scorer";
import {
  requireForecastRuntimeAuthorizedOutcomeV2,
  type ForecastRuntimeAuthorizedOutcomeV2,
} from "@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2";
import {
  persistForecastCalibrationObservationV2,
  persistForecastBundleV2,
  persistObjectiveForecastOutcomeResolutionV2,
  persistPredictivePackageV2,
} from "@/lib/trader/intelligence/forecast-v2/forecast-v2-persistence-service";
import type { ForecastRuntimeInputV2 } from "@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2";
import { TARGET_ROLE_TERMINAL } from "@/lib/trader/intelligence/forecast-v2/constants";
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
import {
  computeForecastV2EvidenceOnlyKnowledgeUpdate,
  computeKnowledgeConfidenceUpdateContentDigest,
  type KnowledgeConfidenceUpdateRecord,
} from "@/lib/trader/knowledge/knowledge-confidence-update";
import { queryMarketKnowledgeReadModel } from "@/lib/trader/knowledge/market-memory";
import { createOutcomeResolutionReadPortPostgres } from "@/lib/trader/knowledge/outcome-resolution-read-port-postgres";
import type { OutcomeResolutionReadPort } from "@/lib/trader/knowledge/mkb-read-model.types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";
import {
  canonicalizeSemanticJsonString,
  computeSemanticSha256Hex,
} from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { materializeExecOppOutcome13dV1 } from "@/lib/trader/intelligence/forecast-v2/exec-opp-outcome-materializer-v1";
import {
  assertHtxVolumeAuthorityQualified,
  type HtxVolumeQualificationReceiptV1,
} from "@/lib/trader/market-data/volume-qualification/htx-volume-qualification";

type PgExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "execute">;

/**
 * DEE-633 pure closure seam. It deliberately returns immutable evidence for the
 * caller's transaction instead of mutating legacy Market Memory. The Knowledge
 * record is visible only from the explicitly supplied future-cycle PIT anchor.
 */
export function buildForecastV2EvidenceOnlyClosure(input: {
  authorizedOutcome: ForecastRuntimeAuthorizedOutcomeV2;
  objectiveEvidence: ForecastV2ObjectiveEvidence;
  futureRunId: string;
  futureCycleId: string;
  futureCyclePitAnchor: string;
  priorMachineRecommendedConfidence: string;
  provenance: OutcomeProvenance;
  sequence: number;
}) {
  const calibrationObservation = scoreForecastV2MulticlassObservation({
    authorizedOutcome: input.authorizedOutcome,
    objectiveEvidence: input.objectiveEvidence,
  });
  const knowledgeUpdate = computeForecastV2EvidenceOnlyKnowledgeUpdate({
    organizationId: input.objectiveEvidence.organizationId,
    futureRunId: input.futureRunId,
    futureCycleId: input.futureCycleId,
    futureCyclePitAnchor: input.futureCyclePitAnchor,
    priorMachineRecommendedConfidence: input.priorMachineRecommendedConfidence,
    calibrationObservation,
    provenance: input.provenance,
    sequence: input.sequence,
  });
  return { calibrationObservation, knowledgeUpdate } as const;
}

/**
 * Transaction-ready production write seam. Callers must supply transaction-bound
 * append-only sinks; the order preserves outcome -> calibration -> future Knowledge.
 */
export async function runForecastV2EvidenceOnlyClosure(
  input: Parameters<typeof buildForecastV2EvidenceOnlyClosure>[0] & {
    persistObjectiveOutcome: (
      observation: ReturnType<typeof scoreForecastV2MulticlassObservation>,
    ) => Promise<void>;
    persistCalibrationObservation: (
      observation: ReturnType<typeof scoreForecastV2MulticlassObservation>,
    ) => Promise<void>;
    persistFutureKnowledgeUpdate: (
      update: ReturnType<typeof computeForecastV2EvidenceOnlyKnowledgeUpdate>,
    ) => Promise<void>;
  },
) {
  const closure = buildForecastV2EvidenceOnlyClosure(input);
  await input.persistObjectiveOutcome(closure.calibrationObservation);
  await input.persistCalibrationObservation(closure.calibrationObservation);
  await input.persistFutureKnowledgeUpdate(closure.knowledgeUpdate);
  return closure;
}

export type ForecastV2TerminalClosurePersistenceInput = Parameters<
  typeof buildForecastV2EvidenceOnlyClosure
>[0] &
  Readonly<{
    organizationId: string;
    bundleId: string;
    forecastId: string;
    objectiveOutcomeContentDigestHex: string;
  }>;

export type ForecastV2DurableProducerConfigV1 = Readonly<{
  sql: postgres.Sql;
  kmGlobalAnchorSetDigestHex: string;
  priorMachineRecommendedConfidence: string;
  provenance: OutcomeProvenance;
  resolveVolumeAuthorityReceipt(symbol: string): HtxVolumeQualificationReceiptV1;
}>;

/** Shared deterministic paper/backtest issuance and terminal lifecycle. */
export function createForecastV2DurableProducerV1(config: ForecastV2DurableProducerConfigV1) {
  const packageIds = new Map<string, string>();
  const pitBars = new Map<string, Bar>();
  const pending: Array<{
    authorizedOutcome: ForecastRuntimeAuthorizedOutcomeV2;
    bundleId: string;
    terminalForecastId: string;
    sequence: number;
  }> = [];
  let hydratedRunKey: string | null = null;

  return {
    async processCycle(input: Readonly<{
      organizationId: string;
      runId: string;
      cycleId: string;
      pitAnchor: string;
      bars: readonly Bar[];
      sequence: number;
      outcome: ForecastRuntimeAuthorizedOutcomeV2 | null;
      runtimeInput?: ForecastRuntimeInputV2;
    }>) {
      const runKey = `${input.organizationId}|${input.runId}`;
      if (hydratedRunKey !== runKey) {
        pending.length = 0;
        pitBars.clear();
        packageIds.clear();
        const persistedBars = await config.sql<{
          symbol: string;
          interval: string;
          bar_close_time: string;
          bar_content_digest: string;
          bar_json: Bar;
        }[]>`
          SELECT symbol, interval, bar_close_time::text AS bar_close_time,
                 bar_content_digest, bar_json
          FROM trader_forecast_pit_bar_v2
          WHERE organization_id = ${input.organizationId}::uuid
            AND run_id = ${input.runId}
            AND interval = '1m'
        `;
        for (const persisted of persistedBars) {
          const bar = persisted.bar_json;
          if (
            persisted.interval !== "1m" ||
            bar.interval !== "1m" ||
            persisted.symbol !== bar.symbol ||
            Date.parse(persisted.bar_close_time) !== Date.parse(bar.barCloseTime) ||
            persisted.bar_content_digest !== computeSemanticSha256Hex(bar)
          ) {
            throw new Error("FORECAST_V2_PERSISTED_PIT_BAR_IDENTITY_MISMATCH");
          }
          pitBars.set(
            `${input.organizationId}|${bar.symbol}|${Date.parse(bar.barCloseTime)}`,
            bar,
          );
        }
        const rows = await config.sql<{
          bundle_id: string;
          forecast_id: string;
          payload: unknown;
          issuance_sequence: number;
        }[]>`
          SELECT b.id::text AS bundle_id, f.id::text AS forecast_id,
                 b.forecast_runtime_authorized_outcome_json AS payload,
                 b.forecast_runtime_issuance_sequence AS issuance_sequence
          FROM trader_forecast_bundle_v2 b
          JOIN trader_forecast_v2 f ON f.organization_id = b.organization_id
            AND f.bundle_id = b.id AND f.target_role_id = ${TARGET_ROLE_TERMINAL}
          LEFT JOIN trader_forecast_outcome_v2 o ON o.organization_id = b.organization_id
            AND o.bundle_id = b.id AND o.forecast_id = f.id
          WHERE b.organization_id = ${input.organizationId}::uuid
            AND b.run_id = ${input.runId}
            AND b.forecast_runtime_authorized_outcome_json IS NOT NULL
            AND o.forecast_id IS NULL
        `;
        for (const persisted of rows) {
          const revived = JSON.parse(JSON.stringify(persisted.payload), (_key, value) =>
            value && value.type === "Buffer" && Array.isArray(value.data)
              ? Buffer.from(value.data)
              : value,
          ) as ForecastRuntimeAuthorizedOutcomeV2;
          const authorizedOutcome = requireForecastRuntimeAuthorizedOutcomeV2(revived);
          if (!pending.some((row) => row.bundleId === persisted.bundle_id)) {
            pending.push({
              authorizedOutcome,
              bundleId: persisted.bundle_id,
              terminalForecastId: persisted.forecast_id,
              sequence: persisted.issuance_sequence,
            });
          }
        }
        hydratedRunKey = runKey;
      }
      const pitEpochMs = Date.parse(input.pitAnchor);
      if (!Number.isSafeInteger(pitEpochMs)) throw new Error("Forecast V2 PIT anchor invalid");
      for (const bar of input.bars) {
        // Forecast-V2's sealed objective materializer is pinned to the canonical
        // one-minute evidence stream.  Other intervals must never enter the PIT
        // cache and accidentally satisfy a terminal measurement.
        if (bar.interval !== "1m") continue;
        const closeEpochMs = Date.parse(bar.barCloseTime);
        if (!Number.isSafeInteger(closeEpochMs) || closeEpochMs > pitEpochMs) continue;
        const key = `${input.organizationId}|${bar.symbol}|${closeEpochMs}`;
        const barDigest = computeSemanticSha256Hex(bar);
        const barJson = canonicalizeSemanticJsonString(bar);
        const inserted = await config.sql<{ bar_content_digest: string }[]>`
          INSERT INTO trader_forecast_pit_bar_v2 (
            organization_id, run_id, symbol, interval, bar_close_time,
            bar_content_digest, bar_json
          ) VALUES (
            ${input.organizationId}::uuid, ${input.runId}, ${bar.symbol}, '1m',
            ${bar.barCloseTime}::timestamptz, ${barDigest}, ${barJson}::text::jsonb
          )
          ON CONFLICT (organization_id, run_id, symbol, interval, bar_close_time)
          DO NOTHING
          RETURNING bar_content_digest
        `;
        const persistedDigest = inserted[0]?.bar_content_digest ?? (
          await config.sql<{ bar_content_digest: string }[]>`
            SELECT bar_content_digest
            FROM trader_forecast_pit_bar_v2
            WHERE organization_id = ${input.organizationId}::uuid
              AND run_id = ${input.runId}
              AND symbol = ${bar.symbol}
              AND interval = '1m'
              AND bar_close_time = ${bar.barCloseTime}::timestamptz
          `
        )[0]?.bar_content_digest;
        if (persistedDigest !== barDigest) {
          throw new Error("FORECAST_V2_PIT_BAR_CONFLICT");
        }
        const existing = pitBars.get(key);
        if (existing && computeSemanticSha256Hex(existing) !== computeSemanticSha256Hex(bar)) {
          throw new Error("FORECAST_V2_PIT_BAR_CONFLICT");
        }
        pitBars.set(key, bar);
      }
      const oldestPendingAnchor = pending.reduce(
        (oldest, row) => Math.min(oldest, row.authorizedOutcome.authority.anchorClosedBarEpochMs),
        Number.POSITIVE_INFINITY,
      );
      const retainAfter = Number.isFinite(oldestPendingAnchor)
        ? oldestPendingAnchor
        : pitEpochMs - 65 * 60_000;
      for (const [key, bar] of pitBars) {
        if (Date.parse(bar.barCloseTime) < retainAfter) pitBars.delete(key);
      }
      if (input.outcome) {
        const digest = input.outcome.authority.selectedPredictivePackageContentDigestHex;
        let packageId = packageIds.get(digest);
        if (!packageId) {
          packageId = (
            await persistPredictivePackageV2(config.sql, input.outcome.issuance.package, {
              organizationId: input.organizationId,
              kmGlobalAnchorSetDigestHex: config.kmGlobalAnchorSetDigestHex,
              idempotencyKey: digest,
            })
          ).packageId;
          packageIds.set(digest, packageId);
        }
        const bundle = await persistForecastBundleV2(config.sql, {
          organizationId: input.organizationId,
          packageId,
          runId: input.runId,
          cycleId: input.cycleId,
          symbol: input.outcome.issuance.package.family.symbol,
          anchorClosedBarEpochMs: input.outcome.authority.anchorClosedBarEpochMs,
          issuance: input.outcome.issuance,
          authorizedOutcome: input.outcome,
          runtimeInput: input.runtimeInput,
          runtimeAuthorityClass: "GENERAL_FORECAST_V2",
          issuanceSequence: input.sequence,
        });
        if (!pending.some((row) => row.bundleId === bundle.bundleId)) {
          pending.push({
            authorizedOutcome: input.outcome,
            bundleId: bundle.bundleId,
            terminalForecastId: bundle.terminalForecastId,
            sequence: input.sequence,
          });
        }
      }

      for (let index = pending.length - 1; index >= 0; index -= 1) {
        const row = pending[index]!;
        const family = row.authorizedOutcome.issuance.package.family;
        const horizon = family.primaryHorizonMinutes;
        if (horizon !== 30 && horizon !== 60) continue;
        const resolvedEpochMs = row.authorizedOutcome.authority.anchorClosedBarEpochMs +
          (horizon + 3) * 60_000;
        if (!Number.isSafeInteger(pitEpochMs) || pitEpochMs <= resolvedEpochMs) continue;
        const receipt = config.resolveVolumeAuthorityReceipt(family.symbol);
        assertHtxVolumeAuthorityQualified(receipt);
        if (
          normalizeSymbolForHistoricalExecution(receipt.symbol) !==
          normalizeSymbolForHistoricalExecution(family.symbol)
        ) {
          throw new Error("FORECAST_V2_VOLUME_AUTHORITY_SYMBOL_MISMATCH");
        }
        const barsByCloseEpochMs = new Map(
          [...pitBars.values()]
            .filter((bar) =>
              bar.interval === "1m" &&
              normalizeSymbolForHistoricalExecution(bar.symbol) ===
                normalizeSymbolForHistoricalExecution(family.symbol),
            )
            .map((bar) => [Date.parse(bar.barCloseTime), {
              closedBarEpochMs: Date.parse(bar.barCloseTime),
              close: Number(bar.close),
              qualifiedBaseVolume: Number(bar.volume),
            }] as const),
        );
        const materialized = materializeExecOppOutcome13dV1({
          primaryHorizonMinutes: horizon,
          anchorClosedBarEpochMs: row.authorizedOutcome.authority.anchorClosedBarEpochMs,
          barsByCloseEpochMs,
        });
        if (!materialized.eligible) continue;
        const resolvedAt = new Date(resolvedEpochMs).toISOString();
        const objectiveEvidence = {
          organizationId: input.organizationId,
          symbol: family.symbol,
          primaryHorizonMinutes: horizon,
          anchorClosedBarEpochMs: row.authorizedOutcome.authority.anchorClosedBarEpochMs,
          resolvedAt,
          pitEvidenceBoundary: resolvedAt,
          observedTerminalReturn: materialized.rH,
          observedOutcomeDigestHex: materialized.outcomeContentDigestHex,
          pitMeasurementIdentityDigestHex: computeSemanticSha256Hex({
            schemaVersion: "waia.trader.forecast_v2_terminal_pit_measurement.v1",
            organizationId: input.organizationId,
            symbol: family.symbol,
            anchorClosedBarEpochMs: row.authorizedOutcome.authority.anchorClosedBarEpochMs,
            primaryHorizonMinutes: horizon,
            resolvedAt,
            pitEvidenceBoundary: resolvedAt,
            terminalTargetDefinitionDigestHex:
              row.authorizedOutcome.authority.terminalTargetDefinitionDigestHex,
            htxVolumeQualificationReceiptDigestHex: receipt.qualificationReceiptDigest,
            observedOutcomeDigestHex: materialized.outcomeContentDigestHex,
          }),
          knowledgeEdgeId: row.authorizedOutcome.authority.knowledgeEdgeId,
          knowledgeContentDigestHex: row.authorizedOutcome.authority.knowledgeContentDigestHex,
        } as const;
        await persistForecastV2TerminalClosurePostgres(config.sql, {
          organizationId: input.organizationId,
          bundleId: row.bundleId,
          forecastId: row.terminalForecastId,
          authorizedOutcome: row.authorizedOutcome,
          objectiveEvidence,
          objectiveOutcomeContentDigestHex: computeSemanticSha256Hex(objectiveEvidence),
          futureRunId: input.runId,
          futureCycleId: input.cycleId,
          futureCyclePitAnchor: input.pitAnchor,
          priorMachineRecommendedConfidence: config.priorMachineRecommendedConfidence,
          provenance: config.provenance,
          sequence: row.sequence,
        });
        pending.splice(index, 1);
      }
      return { pendingCount: pending.length } as const;
    },
  };
}

async function persistForecastV2KnowledgeUpdateInTransaction(
  sql: postgres.Sql,
  context: { organizationId: string },
  record: KnowledgeConfidenceUpdateRecord,
): Promise<void> {
  if (
    record.organizationId !== context.organizationId ||
    computeKnowledgeConfidenceUpdateContentDigest(record) !== record.contentDigest
  ) {
    throw new Error("knowledge confidence update identity/digest mismatch");
  }
  const existing = await sql<{ content_digest: string }[]>`
    SELECT content_digest FROM trader_knowledge_confidence_update_record
    WHERE organization_id = ${context.organizationId}::uuid
      AND idempotency_key = ${record.idempotencyKey}
    LIMIT 1
  `;
  if (existing[0]) {
    if (existing[0].content_digest !== record.contentDigest) {
      throw new Error("knowledge confidence update conflict with mismatched digest");
    }
    return;
  }
  await sql`
    INSERT INTO trader_knowledge_confidence_update_record (
      id, organization_id, run_id, cycle_id, symbol, knowledge_edge_id,
      update_kind, update_model_version, prior_confidence, posterior_confidence,
      delta, issued_at, eligible_resolution_at, resolved_at, pit_evidence_boundary,
      outcome_class, score, source_record_ids_json, content_digest, idempotency_key,
      provenance_json, terminal_reason, schema_version
    ) VALUES (
      ${record.id}::uuid, ${context.organizationId}::uuid, ${record.runId}, ${record.cycleId},
      ${record.symbol}, ${record.knowledgeEdgeId}::uuid, ${record.updateKind},
      ${record.updateModelVersion}, ${record.priorMachineRecommendedConfidence},
      ${record.machineRecommendedConfidence}, ${record.machineRecommendedDelta},
      ${record.issuedAt}::timestamptz, ${record.eligibleResolutionAt}::timestamptz,
      ${record.resolvedAt}::timestamptz, ${record.pitEvidenceBoundary}::timestamptz,
      ${record.outcomeClass}, ${record.score}, ${record.sourceRecordIdsJson},
      ${record.contentDigest}, ${record.idempotencyKey}, ${JSON.stringify(record.provenance)},
      ${record.terminalReason}, ${record.schemaVersion}
    )
  `;
}

/** Concrete production terminal transaction: objective outcome, calibration and
 * future-only Knowledge evidence either all commit or all roll back. */
export async function persistForecastV2TerminalClosurePostgres(
  sql: postgres.Sql,
  input: ForecastV2TerminalClosurePersistenceInput,
) {
  const closure = buildForecastV2EvidenceOnlyClosure(input);
  if (input.organizationId !== input.objectiveEvidence.organizationId) {
    throw new Error("Forecast V2 terminal closure organization mismatch");
  }
  await withPostgresSessionTransaction(sql, "SERIALIZABLE", async (transactionSql) => {
    await persistObjectiveForecastOutcomeResolutionV2(transactionSql, {
      organizationId: input.organizationId,
      bundleId: input.bundleId,
      forecastId: input.forecastId,
      targetRoleId: TARGET_ROLE_TERMINAL,
      resolvedAtIso: input.objectiveEvidence.resolvedAt,
      anchorClosedBarEpochMs: input.authorizedOutcome.authority.anchorClosedBarEpochMs,
      primaryHorizonMinutes: closure.calibrationObservation.primaryHorizonMinutes,
      observedOutcomeDigestHex: input.objectiveEvidence.observedOutcomeDigestHex,
      contentDigestHex: input.objectiveOutcomeContentDigestHex,
      pitMeasurementIdentityDigestHex: input.objectiveEvidence.pitMeasurementIdentityDigestHex,
      feedbackPayload: {
        authorizedOutcome: input.authorizedOutcome,
        objectiveEvidence: input.objectiveEvidence,
      },
    });
    await persistForecastCalibrationObservationV2(transactionSql, {
      organizationId: input.organizationId,
      bundleId: input.bundleId,
      forecastId: input.forecastId,
      targetRoleId: TARGET_ROLE_TERMINAL,
      contentDigestHex: closure.calibrationObservation.contentDigest,
      scoringEligible: true,
      observation: closure.calibrationObservation,
    });
    await persistForecastV2KnowledgeUpdateInTransaction(
      transactionSql,
      { organizationId: input.organizationId },
      closure.knowledgeUpdate,
    );
  });
  return closure;
}

function rebindWp21DepsForExecutor(base: Wp21RuntimeDeps, ex: PgExecutor): Wp21RuntimeDeps {
  const bound = createWp21RuntimeDepsPostgres(ex);
  return {
    ...base,
    outcomeResolutionSink: bound.outcomeResolutionSink,
    calibrationSink: bound.calibrationSink,
    confidenceUpdateSink: bound.confidenceUpdateSink,
    outcomeResolutionReadPort: bound.outcomeResolutionReadPort,
    source: bound.source,
  };
}

async function withWp21PersistenceTransaction<T>(
  pgDb: WaiaPostgresDb | undefined,
  baseDeps: Wp21RuntimeDeps,
  run: (deps: Wp21RuntimeDeps) => Promise<T>,
): Promise<T> {
  if (!pgDb) {
    return run(baseDeps);
  }
  return runWaiaPostgresTransaction(pgDb, async (tx) =>
    run(rebindWp21DepsForExecutor(baseDeps, tx)),
  );
}

async function withWp21PersistenceTransactionEx<T>(
  pgDb: WaiaPostgresDb | undefined,
  baseDeps: Wp21RuntimeDeps,
  fallbackEx: PgExecutor,
  run: (deps: Wp21RuntimeDeps, ex: PgExecutor) => Promise<T>,
): Promise<T> {
  if (!pgDb) {
    return run(baseDeps, fallbackEx);
  }
  return runWaiaPostgresTransaction(pgDb, async (tx) =>
    run(rebindWp21DepsForExecutor(baseDeps, tx), tx),
  );
}

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
  /** Full Postgres db handle — opens a transaction for savepoint-backed WP21 inserts. */
  pgDb?: WaiaPostgresDb;
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
  return withWp21PersistenceTransaction(input.pgDb, input.deps, async (deps) => {
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
      source: deps.source,
      sink: deps.outcomeResolutionSink,
      provenance: input.provenance,
    });

    const hypothesisOutcomes = await resolveEligibleHypothesisOutcomes({
      context: input.context,
      runId: input.runId,
      asOf: input.asOf,
      source: deps.source,
      sink: deps.outcomeResolutionSink,
      provenance: input.provenance,
    });

    const abstentionOutcomes = await scoreAbstentionOutcomes({
      context: input.context,
      runId: input.runId,
      asOf: input.asOf,
      pitWindow,
      source: deps.source,
      sink: deps.outcomeResolutionSink,
      provenance: input.provenance,
    });

    const checkpoint = mergeWp21CheckpointState(input.checkpoint, {
      resolvedForecastOutcomeIds: forecastOutcomes.map((row) => row.id),
      resolvedHypothesisOutcomeIds: hypothesisOutcomes.map((row) => row.id),
      processedAbstentionDecisionIds: abstentionOutcomes.map((row) => row.decisionRecordId),
      lastEligibleResolutionTime: input.asOf,
    });

    return {
      forecastOutcomes,
      hypothesisOutcomes,
      abstentionOutcomes,
      checkpoint,
    };
  });
}

export type RunWp21TerminalSeamInput = Readonly<{
  context: OrgContext;
  runId: string;
  asOf: string;
  deps: Wp21RuntimeDeps;
  provenance: OutcomeProvenance;
  ex: PgExecutor;
  checkpoint?: Wp21CheckpointState;
  pgDb?: WaiaPostgresDb;
  forecastV2Sql?: postgres.Sql;
  forecastV2TerminalClosures?: readonly ForecastV2TerminalClosurePersistenceInput[];
}>;

export type RunWp21TerminalSeamResult = Readonly<{
  calibrationSnapshotCount: number;
  mkbQueryExecuted: boolean;
  checkpoint: Wp21CheckpointState;
}>;

export async function runWp21TerminalSeam(
  input: RunWp21TerminalSeamInput,
): Promise<RunWp21TerminalSeamResult> {
  if ((input.forecastV2TerminalClosures?.length ?? 0) > 0 && !input.forecastV2Sql) {
    throw new Error("Forecast V2 terminal closures require concrete PostgreSQL authority");
  }
  for (const closure of input.forecastV2TerminalClosures ?? []) {
    await persistForecastV2TerminalClosurePostgres(input.forecastV2Sql!, closure);
  }
  return withWp21PersistenceTransactionEx(input.pgDb, input.deps, input.ex, async (deps, ex) => {
    const outcomes =
      await deps.outcomeResolutionSink.forecastOutcomeRepository.listUnresolvedForRun(
        input.context,
        input.runId,
      );

    const forecasts = await deps.source.listForecastsEligibleForResolution(
      input.context,
      input.runId,
      input.asOf,
    );

    const observations = [];
    for (const outcome of outcomes) {
      const existing = await deps.calibrationSink.observationRepository.findByForecastOutcomeId(
        input.context,
        outcome.id,
      );
      if (existing) {
        observations.push(existing);
        continue;
      }

      const forecast = forecasts.find((row) => row.id === outcome.forecastRecordId);
      if (!forecast) {
        const allForecasts = await deps.source.listForecastsEligibleForResolution(
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
        await deps.calibrationSink.observationRepository.insert(input.context, observation);
        observations.push(observation);
        continue;
      }

      const observation = scoreForecastCalibrationObservation({
        context: input.context,
        forecast,
        outcome,
        provenance: input.provenance,
      });
      await deps.calibrationSink.observationRepository.insert(input.context, observation);
      observations.push(observation);
    }

    const allObservations = await deps.calibrationSink.observationRepository.listForRun(
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
      await deps.calibrationSink.snapshotRepository.insert(input.context, snapshot);
    }

    await queryMarketKnowledgeReadModel(
      ex,
      input.context,
      { runId: input.runId },
      new Date(input.asOf),
      deps.outcomeResolutionReadPort,
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
  });
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
