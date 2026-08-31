import type postgres from "postgres";

import {
  computeKnowledgeCheckpointContentDigest,
  type KnowledgeCheckpointInput,
} from "@/lib/trader/intelligence/knowledge-state/knowledge-state-checkpoint-v2";
import {
  buildKnowledgeCheckpointRecord,
  restoreKnowledgeCheckpointV2,
  writeKnowledgeCheckpointV2,
  type RestoredKnowledgeCheckpointV2,
} from "@/lib/trader/intelligence/knowledge-state/knowledge-state-checkpoint-service-v2";
import {
  createForecastV2DurableProducerV1,
  type ForecastV2DurableProducerConfigV1,
} from "@/lib/trader/intelligence/outcome-resolution/epistemic-closure-runtime";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import type {
  HistoricalKnowledgePortV2,
  HistoricalKnowledgeSnapshotV2,
  HistoricalMaturedClosureV2,
} from "@/lib/trader/backtest/historical-simulation-v2";

export const HISTORICAL_SIMULATION_KNOWLEDGE_BINDING_V2 =
  "waia.trader.historical_simulation_knowledge_binding.v2" as const;

type KnowledgeRowV2 = Readonly<{
  id: string;
  knowledge_edge_id: string;
  content_digest: string;
  resolved_at: Date | string;
  pit_evidence_boundary: Date | string;
  source_record_ids_json: string;
}>;

type ParsedFutureEvidenceV2 = Readonly<{
  visibleFromPitAnchor: string;
  forecastAuthorityContentDigestHex: string;
  outcomeContentDigestHex: string;
}>;

const DIGEST = /^[0-9a-f]{64}$/;

function canonicalUtc(value: string, field: string): number {
  const epoch = Date.parse(value);
  if (!Number.isSafeInteger(epoch) || new Date(epoch).toISOString() !== value) {
    throw new Error(`HISTORICAL_SIMULATION_KNOWLEDGE_INVALID:${field}`);
  }
  return epoch;
}

function postgresTimestampIso(value: Date | string, field: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`HISTORICAL_SIMULATION_KNOWLEDGE_INVALID:${field}`);
  }
  return date.toISOString();
}

function requireDigest(value: string, field: string): void {
  if (!DIGEST.test(value)) throw new Error(`HISTORICAL_SIMULATION_KNOWLEDGE_INVALID:${field}`);
}

function parseFutureEvidence(row: KnowledgeRowV2): ParsedFutureEvidenceV2 {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(row.source_record_ids_json) as Record<string, unknown>;
  } catch {
    throw new Error("HISTORICAL_SIMULATION_KNOWLEDGE_CORRUPTION:sourceRecordIdsJson");
  }
  const visibleFromPitAnchor = payload.visible_from_cycle_pit_anchor;
  const forecastAuthorityContentDigestHex =
    payload.forecast_runtime_authority_content_digest_hex;
  const outcomeContentDigestHex = payload.forecast_outcome_content_digest_hex;
  if (
    typeof visibleFromPitAnchor !== "string" ||
    typeof forecastAuthorityContentDigestHex !== "string" ||
    typeof outcomeContentDigestHex !== "string"
  ) {
    throw new Error("HISTORICAL_SIMULATION_KNOWLEDGE_CORRUPTION:futureEvidenceIdentity");
  }
  canonicalUtc(visibleFromPitAnchor, "visibleFromPitAnchor");
  requireDigest(forecastAuthorityContentDigestHex, "forecastAuthorityContentDigestHex");
  requireDigest(outcomeContentDigestHex, "outcomeContentDigestHex");
  requireDigest(row.content_digest, "knowledgeUpdateContentDigest");
  return { visibleFromPitAnchor, forecastAuthorityContentDigestHex, outcomeContentDigestHex };
}

function snapshotDigest(input: {
  organizationId: string;
  symbol: string;
  rows: readonly KnowledgeRowV2[];
}): string {
  return computeSemanticSha256Hex({
    schemaVersion: HISTORICAL_SIMULATION_KNOWLEDGE_BINDING_V2,
    organizationId: input.organizationId,
    symbol: input.symbol,
    visibleEvidence: input.rows
      .map((row) => ({
        id: row.id,
        knowledgeEdgeId: row.knowledge_edge_id,
        contentDigestHex: row.content_digest,
        resolvedAt: postgresTimestampIso(row.resolved_at, "resolvedAt"),
        pitEvidenceBoundary: postgresTimestampIso(row.pit_evidence_boundary, "pitEvidenceBoundary"),
        ...parseFutureEvidence(row),
      }))
      .sort((left, right) => left.contentDigestHex.localeCompare(right.contentDigestHex)),
  });
}

export type HistoricalSimulationKnowledgeCheckpointStoreV2 = Readonly<{
  write(input: KnowledgeCheckpointInput): Promise<void>;
  restore(input: { organizationId: string; checkpointSeq: number }): Promise<RestoredKnowledgeCheckpointV2>;
}>;

function createPostgresCheckpointStore(
  sql: postgres.Sql,
): HistoricalSimulationKnowledgeCheckpointStoreV2 {
  return {
    async write(input) {
      await writeKnowledgeCheckpointV2(sql, buildKnowledgeCheckpointRecord(input));
    },
    restore(input) {
      return restoreKnowledgeCheckpointV2(sql, input);
    },
  };
}

function checkpointModelVersion(input: { runId: string; modelVersion: string }): string {
  if (!input.runId.trim() || !input.modelVersion.trim()) {
    throw new Error("HISTORICAL_SIMULATION_KNOWLEDGE_INVALID:checkpointIdentity");
  }
  return `${HISTORICAL_SIMULATION_KNOWLEDGE_BINDING_V2}|${input.runId}|${input.modelVersion}`;
}

export type HistoricalSimulationPostgresKnowledgePortV2 = HistoricalKnowledgePortV2 &
  Readonly<{
    processForecastCycle: ReturnType<typeof createForecastV2DurableProducerV1>["processCycle"];
    checkpoint(input: Readonly<{
      runId: string;
      checkpointSeq: number;
      pitAnchor: string;
      modelVersion: string;
      forecastPackageGenerationDigest?: string;
    }>): Promise<Readonly<{ snapshot: HistoricalKnowledgeSnapshotV2; checkpointContentDigest: string }>>;
    restoreCheckpoint(input: Readonly<{
      runId: string;
      checkpointSeq: number;
      pitAnchor: string;
      modelVersion: string;
    }>): Promise<Readonly<{ snapshot: HistoricalKnowledgeSnapshotV2; checkpointContentDigest: string }>>;
  }>;

export function createHistoricalSimulationPostgresKnowledgePortV2(input: Readonly<{
  sql: postgres.Sql;
  organizationId: string;
  symbol: string;
  forecastProducer: Omit<ForecastV2DurableProducerConfigV1, "sql">;
  checkpointStore?: HistoricalSimulationKnowledgeCheckpointStoreV2;
}>): HistoricalSimulationPostgresKnowledgePortV2 {
  if (!input.organizationId.trim() || !input.symbol.trim()) {
    throw new Error("HISTORICAL_SIMULATION_KNOWLEDGE_INVALID:scope");
  }
  const producer = createForecastV2DurableProducerV1({ ...input.forecastProducer, sql: input.sql });
  const checkpointStore = input.checkpointStore ?? createPostgresCheckpointStore(input.sql);

  const rowsVisibleAsOf = async (asOf: string): Promise<readonly KnowledgeRowV2[]> => {
    canonicalUtc(asOf, "asOf");
    return input.sql<KnowledgeRowV2[]>`
      SELECT id::text, knowledge_edge_id::text, content_digest,
             resolved_at, pit_evidence_boundary, source_record_ids_json
      FROM trader_knowledge_confidence_update_record
      WHERE organization_id = ${input.organizationId}::uuid
        AND symbol = ${input.symbol}
        AND update_model_version LIKE '%.forecast-v2-evidence-only'
        AND (source_record_ids_json::jsonb ->> 'visible_from_cycle_pit_anchor')::timestamptz
              <= ${asOf}::timestamptz
      ORDER BY content_digest ASC
    `;
  };

  const snapshotAsOf = async (asOf: string): Promise<HistoricalKnowledgeSnapshotV2> => {
    const rows = await rowsVisibleAsOf(asOf);
    for (const row of rows) {
      const evidence = parseFutureEvidence(row);
      if (canonicalUtc(evidence.visibleFromPitAnchor, "visibleFromPitAnchor") > Date.parse(asOf)) {
        throw new Error("HISTORICAL_SIMULATION_KNOWLEDGE_PIT_LEAKAGE");
      }
    }
    return Object.freeze({
      asOf,
      contentDigestHex: snapshotDigest({
        organizationId: input.organizationId,
        symbol: input.symbol,
        rows,
      }),
    });
  };

  const closeMaturedForecasts = async (
    strictlyBefore: string,
  ): Promise<readonly HistoricalMaturedClosureV2[]> => {
    const boundary = canonicalUtc(strictlyBefore, "strictlyBefore");
    const rows = await rowsVisibleAsOf(strictlyBefore);
    return Object.freeze(
      rows.flatMap((row) => {
        const evidence = parseFutureEvidence(row);
        const resolvedAt = postgresTimestampIso(row.resolved_at, "resolvedAt");
        const maturedAt = canonicalUtc(resolvedAt, "resolvedAt");
        if (maturedAt >= boundary) return [];
        if (evidence.visibleFromPitAnchor !== strictlyBefore) return [];
        return [{
          forecastAuthorityContentDigestHex: evidence.forecastAuthorityContentDigestHex,
          maturedAt: resolvedAt,
          outcomeContentDigestHex: evidence.outcomeContentDigestHex,
        }];
      }),
    );
  };

  const applyMaturedClosures: HistoricalKnowledgePortV2["applyMaturedClosures"] = async ({
    strictlyBefore,
    closures,
  }) => {
    const expected = await closeMaturedForecasts(strictlyBefore);
    const identity = (values: readonly HistoricalMaturedClosureV2[]) =>
      computeSemanticSha256Hex([...values].sort((a, b) =>
        a.outcomeContentDigestHex.localeCompare(b.outcomeContentDigestHex)));
    if (identity(expected) !== identity(closures)) {
      throw new Error("HISTORICAL_SIMULATION_KNOWLEDGE_CLOSURE_MISMATCH");
    }
    return snapshotAsOf(strictlyBefore);
  };

  return Object.freeze({
    snapshotAsOf,
    closeMaturedForecasts,
    applyMaturedClosures,
    processForecastCycle: producer.processCycle,
    async checkpoint(checkpointInput) {
      const snapshot = await snapshotAsOf(checkpointInput.pitAnchor);
      const knowledgeInput: KnowledgeCheckpointInput = {
        organizationId: input.organizationId,
        checkpointSeq: checkpointInput.checkpointSeq,
        modelVersion: checkpointModelVersion(checkpointInput),
        calibrationSnapshotDigest: snapshot.contentDigestHex,
        rejectedResearchStates: [],
        promotedResearchStates: [snapshot.contentDigestHex],
        forecastPackageGenerationDigest: checkpointInput.forecastPackageGenerationDigest,
      };
      await checkpointStore.write(knowledgeInput);
      const checkpointContentDigest = computeKnowledgeCheckpointContentDigest(knowledgeInput);
      return Object.freeze({ snapshot, checkpointContentDigest });
    },
    async restoreCheckpoint(restoreInput) {
      const restored = await checkpointStore.restore({
        organizationId: input.organizationId,
        checkpointSeq: restoreInput.checkpointSeq,
      });
      const expectedModelVersion = checkpointModelVersion(restoreInput);
      if (restored.input.modelVersion !== expectedModelVersion) {
        throw new Error("HISTORICAL_SIMULATION_KNOWLEDGE_RESUME_IDENTITY_MISMATCH");
      }
      const snapshot = await snapshotAsOf(restoreInput.pitAnchor);
      if (
        snapshot.contentDigestHex !== restored.input.calibrationSnapshotDigest ||
        restored.knowledgeSemanticDigest.length !== 64 ||
        restored.contentDigest.length !== 64
      ) {
        throw new Error("HISTORICAL_SIMULATION_KNOWLEDGE_RESUME_PARITY_MISMATCH");
      }
      return Object.freeze({ snapshot, checkpointContentDigest: restored.contentDigest });
    },
  });
}
