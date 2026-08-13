import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type postgres from "postgres";

import {
  FHV_CHECKPOINT_SUPPORTED_ENVELOPE_BYTES,
  measureFhvCheckpointSnapshotCost,
} from "@/lib/trader/observability/fhv-checkpoint-cost-model";
import { FHV_THROUGHPUT_MAX_GROWTH_BYTES_PER_CYCLE } from "@/lib/trader/observability/fhv-throughput-receipt";
import {
  appendA3DiagnosticLog,
  assertA3Phase01StageHealthy,
  advanceA3Phase01ChunkProgress,
  collectPostgresBlockingLockDiagnostics,
  createInitialA3Phase01ProgressRecord,
  markA3Phase01ProgressTerminal,
  waitForBulkBundleInsertWithProgress,
  writeA3Phase01ProgressRecordAtomic,
  type A3Phase01DiagnosticContextV1,
  type A3Phase01ProgressRecordV1,
} from "./a3-phase01-progress-diagnostics-v1";
import {
  assertObservedPackageSurfaceProof,
  queryObservedPackageSurfaceProof,
  type A3ObservedPackageSurfaceProofV1,
} from "./a3-observed-package-surface-v1";
import {
  capturePostgresMeasurementEnvironment,
  type A3PostgresMeasurementEnvironmentV1,
} from "./a3-postgres-measurement-environment-v1";
import { buildA3IncompressibleReplicaPayloadV1 } from "./a3-incompressible-replica-payload-v1";
import {
  FORECAST_V2_STORAGE_MIGRATION_MIN,
  assertForecastV2AppliedMigrationIdentity,
} from "./forecast-v2-applied-migration-identity-v1";
import {
  computeForecastV2TotalProjectedBytes,
  evaluateForecastV2StorageScaleReceipt,
  FORECAST_V2_OFFICIAL_BUNDLE_COUNT,
  FORECAST_V2_PACKAGE_REPLICA_PAYLOAD_BYTES,
  FORECAST_V2_PROPORTIONAL_ROWS_PER_BUNDLE,
} from "./storage-scale-projection";

export const FORECAST_V2_STORAGE_TABLES = [
  "trader_forecast_target_definition_v2",
  "trader_forecast_target_bucket_v2",
  "trader_forecast_predictive_package_v2",
  "trader_forecast_predictive_package_target_v2",
  "trader_forecast_replica_artifact_v2",
  "trader_forecast_bundle_v2",
  "trader_forecast_v2",
  "trader_forecast_outcome_v2",
  "trader_forecast_calibration_observation_v2",
  "trader_forecast_scenario_v2",
] as const;

export const FORECAST_V2_PACKAGE_FIXED_TABLES = [
  "trader_forecast_target_definition_v2",
  "trader_forecast_target_bucket_v2",
  "trader_forecast_predictive_package_v2",
  "trader_forecast_predictive_package_target_v2",
  "trader_forecast_replica_artifact_v2",
] as const;

export const DEE_518_BLOCKED_PACKAGE_FIXED_BYTE_IDENTITY_RECONCILIATION_REQUIRED =
  "DEE_518_BLOCKED_PACKAGE_FIXED_BYTE_IDENTITY_RECONCILIATION_REQUIRED" as const;

export const A3_PHASE3_N1_BUNDLES = 1_000;
export const A3_CANONICAL_N_BUNDLES = 200_000;
const PHASE3_BOUNDED_FHV_SESSION_BYTES = 8 * 1024 * 1024;
const DIGEST = "a".repeat(64);

export type ForecastV2RelationSizeBreakdown = {
  relname: string;
  totalBytes: number;
  tableBytes: number;
  indexBytes: number;
  toastBytes: number;
};

export type ForecastV2FixedV2ClassificationItem = {
  surface: string;
  category: "bundle-proportional" | "active-package-fixed" | "other-fixed-v2" | "excluded-by-plan";
  scopeReason?: string;
};

export type ForecastV2FormulaPopulationIdentity = {
  proven: boolean;
  phase1SeedPackageRows: {
    predictivePackages: number;
    targetDefinitions: number;
    targetBuckets: number;
    packageTargets: number;
    replicaArtifacts: number;
  };
  phase2WorstCaseRowsPerCell: {
    predictivePackages: number;
    targetDefinitions: number;
    targetBuckets: number;
    packageTargets: number;
    replicaArtifacts: number;
  };
  phase1SeedPackageContributionBytes: number;
  phase2PackageFixedContributionBytes: number;
  reconciliationNote: string;
};

export type ForecastV2Phase3NIndependenceProof = {
  n1Bundles: number;
  n2Bundles: number;
  checkpointBytesAtN1: number;
  checkpointBytesAtN2: number;
  checkpointSessionBytes: number;
  maxGrowthBytesPerCycle: number;
  supportedCheckpointEnvelopeBytes: number;
  bundleHistoryInFhvHotCheckpointPath: boolean;
  bounded: boolean;
  evidence: string;
};

export type ForecastV2StorageScaleMeasuredReceipt = {
  schemaVersion: "forecast-v2-storage-scale-measured-receipt/v1";
  postgresServerVersion: string;
  appliedMigrationRange: { min: number; max: number; count: number };
  nBundles: number;
  b0Bytes: number;
  b1Bytes: number;
  b0RelationBreakdown: readonly ForecastV2RelationSizeBreakdown[];
  b1RelationBreakdown: readonly ForecastV2RelationSizeBreakdown[];
  rowCounts: Record<string, number>;
  bytesPerCompleteBundle: number;
  phase2FreshDatabaseLiteral: boolean;
  phase2EmptyBytes: number;
  phase2FullBytes: number;
  phase2RelationBreakdown: readonly ForecastV2RelationSizeBreakdown[];
  packageFixedContributionBytes: number;
  packageRawReplicaPayloadBytes: number;
  enumeratedFixedV2OtherItems: readonly ForecastV2FixedV2ClassificationItem[];
  enumeratedFixedV2OtherBytes: number;
  formulaPopulationIdentity: ForecastV2FormulaPopulationIdentity;
  totalProjectedBytes: number;
  phase3HotCheckpointBounded: boolean;
  phase3NIndependenceProof: ForecastV2Phase3NIndependenceProof;
  pass: boolean;
  failureReasons: string[];
};

export function enumerateFixedV2OtherSurfaces(): {
  items: ForecastV2FixedV2ClassificationItem[];
  enumeratedFixedV2OtherBytes: number;
} {
  const items: ForecastV2FixedV2ClassificationItem[] = [
    { surface: "trader_forecast_bundle_v2", category: "bundle-proportional" },
    { surface: "trader_forecast_v2", category: "bundle-proportional" },
    { surface: "trader_forecast_outcome_v2", category: "bundle-proportional" },
    { surface: "trader_forecast_calibration_observation_v2", category: "bundle-proportional" },
    { surface: "trader_forecast_scenario_v2", category: "bundle-proportional" },
    { surface: "trader_forecast_target_definition_v2", category: "active-package-fixed" },
    { surface: "trader_forecast_target_bucket_v2", category: "active-package-fixed" },
    { surface: "trader_forecast_predictive_package_v2", category: "active-package-fixed" },
    { surface: "trader_forecast_predictive_package_target_v2", category: "active-package-fixed" },
    { surface: "trader_forecast_replica_artifact_v2", category: "active-package-fixed" },
    {
      surface: "research/pattern/knowledge tables (migrations 0130–0137)",
      category: "excluded-by-plan",
      scopeReason:
        "plan §5 relation cardinality: FIXED GLOBAL / OUT OF SCOPE for bundle projection",
    },
  ];
  return { items, enumeratedFixedV2OtherBytes: 0 };
}

export async function measureEnumeratedFixedV2OtherEvidence(sql: postgres.Sql): Promise<{
  items: ForecastV2FixedV2ClassificationItem[];
  enumeratedFixedV2OtherBytes: number;
  measuredSurfaces: readonly { surface: string; totalBytes: number }[];
}> {
  const { items } = enumerateFixedV2OtherSurfaces();
  const otherFixedItems = items.filter((item) => item.category === "other-fixed-v2");
  const measuredSurfaces: { surface: string; totalBytes: number }[] = [];

  for (const item of otherFixedItems) {
    const rows = await sql<{ relname: string }[]>`
      SELECT c.relname
      FROM pg_class c
      WHERE c.relname = ${item.surface}
    `;
    if (rows.length === 0) {
      measuredSurfaces.push({ surface: item.surface, totalBytes: 0 });
      continue;
    }
    const sizeRows = await sql<{ total_bytes: string }[]>`
      SELECT pg_total_relation_size(${item.surface}::regclass)::text AS total_bytes
    `;
    measuredSurfaces.push({
      surface: item.surface,
      totalBytes: Number(sizeRows[0]?.total_bytes ?? 0),
    });
  }

  const excludedPresent = await sql<{ relname: string }[]>`
    SELECT relname
    FROM pg_class
    WHERE relname LIKE 'trader_pattern%'
      OR relname LIKE 'trader_knowledge%'
      OR relname LIKE 'trader_research_trial%'
  `;
  if (excludedPresent.length > 0) {
    throw new Error(
      `[forecast-v2/storage-scale] excluded research surfaces present: ${excludedPresent.map((row) => row.relname).join(",")}`,
    );
  }

  const enumeratedFixedV2OtherBytes = measuredSurfaces.reduce(
    (acc, row) => acc + row.totalBytes,
    0,
  );
  return { items, enumeratedFixedV2OtherBytes, measuredSurfaces };
}

async function measureRelationBreakdownForTables(
  sql: postgres.Sql,
  tables: readonly string[],
): Promise<ForecastV2RelationSizeBreakdown[]> {
  const rows = await sql<
    {
      relname: string;
      total_bytes: string;
      table_bytes: string;
      index_bytes: string;
      toast_bytes: string;
    }[]
  >`
    SELECT
      c.relname,
      pg_total_relation_size(c.oid)::text AS total_bytes,
      pg_relation_size(c.oid)::text AS table_bytes,
      pg_indexes_size(c.oid)::text AS index_bytes,
      COALESCE(pg_total_relation_size(c.reltoastrelid), 0)::text AS toast_bytes
    FROM pg_class c
    WHERE c.relname = ANY(${tables as unknown as string[]})
    ORDER BY c.relname
  `;
  return rows.map((row) => ({
    relname: row.relname,
    totalBytes: Number(row.total_bytes),
    tableBytes: Number(row.table_bytes),
    indexBytes: Number(row.index_bytes),
    toastBytes: Number(row.toast_bytes),
  }));
}

async function measureForecastV2RelationBreakdown(
  sql: postgres.Sql,
): Promise<ForecastV2RelationSizeBreakdown[]> {
  return measureRelationBreakdownForTables(sql, FORECAST_V2_STORAGE_TABLES);
}

export async function measurePackageFixedRelationBreakdown(
  sql: postgres.Sql,
): Promise<ForecastV2RelationSizeBreakdown[]> {
  return measureRelationBreakdownForTables(sql, FORECAST_V2_PACKAGE_FIXED_TABLES);
}

export async function measurePackageFixedBytes(sql: postgres.Sql): Promise<number> {
  const breakdown = await measurePackageFixedRelationBreakdown(sql);
  return breakdown.reduce((acc, row) => acc + row.totalBytes, 0);
}

async function measureForecastV2Bytes(sql: postgres.Sql): Promise<number> {
  const breakdown = await measureForecastV2RelationBreakdown(sql);
  return breakdown.reduce((acc, row) => acc + row.totalBytes, 0);
}

export async function assertForecastV2TablesEmpty(
  sql: postgres.Sql,
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of FORECAST_V2_STORAGE_TABLES) {
    const rows = (await sql.unsafe(`SELECT count(*)::text AS count FROM ${table}`)) as {
      count: string;
    }[];
    const count = Number(rows[0]?.count ?? 0);
    counts[table] = count;
    if (count !== 0) {
      throw new Error(`[forecast-v2/storage-scale] expected empty ${table}, got ${count}`);
    }
  }
  return counts;
}

export async function assertForecastV2MigrationRange(
  sql: postgres.Sql,
  repoRoot: string,
): Promise<{
  min: number;
  max: number;
  count: number;
}> {
  const rows = await sql<{ relname: string }[]>`
    SELECT c.relname
    FROM pg_class c
    WHERE c.relname = ANY(${FORECAST_V2_STORAGE_TABLES as unknown as string[]})
  `;
  if (rows.length !== FORECAST_V2_STORAGE_TABLES.length) {
    throw new Error(
      `[forecast-v2/storage-scale] expected ${FORECAST_V2_STORAGE_TABLES.length} V2 relations, found ${rows.length}`,
    );
  }
  const identity = await assertForecastV2AppliedMigrationIdentity(sql, repoRoot);
  if (identity.min !== FORECAST_V2_STORAGE_MIGRATION_MIN) {
    throw new Error(
      `[forecast-v2/storage-scale] applied migration min=${identity.min} expected ${FORECAST_V2_STORAGE_MIGRATION_MIN}`,
    );
  }
  return {
    min: identity.min,
    max: identity.max,
    count: identity.count,
  };
}

async function assertExactBundleRowCounts(
  sql: postgres.Sql,
  organizationId: string,
  nBundles: number,
): Promise<Record<string, number>> {
  const expected = {
    trader_forecast_bundle_v2: nBundles,
    trader_forecast_v2: nBundles * 2,
    trader_forecast_outcome_v2: nBundles * 2,
    trader_forecast_calibration_observation_v2: nBundles * 2,
    trader_forecast_scenario_v2: nBundles * 7,
  };
  const counts: Record<string, number> = {};
  for (const [table, expectedCount] of Object.entries(expected)) {
    const rows = (await sql.unsafe(
      `SELECT count(*)::text AS count FROM ${table} WHERE organization_id = $1::uuid`,
      [organizationId],
    )) as { count: string }[];
    const actual = Number(rows[0]?.count ?? 0);
    counts[table] = actual;
    if (actual !== expectedCount) {
      throw new Error(
        `[forecast-v2/storage-scale] ${table} expected ${expectedCount} rows, got ${actual}`,
      );
    }
  }
  const eoScenarios = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count
    FROM trader_forecast_scenario_v2 s
    JOIN trader_forecast_v2 f ON f.id = s.forecast_id AND f.organization_id = s.organization_id
    WHERE s.organization_id = ${organizationId}::uuid
      AND f.target_role_id = 'EXECUTION_OPPORTUNITY'
  `;
  if (Number(eoScenarios[0]?.count ?? 0) !== 0) {
    throw new Error("[forecast-v2/storage-scale] execution-opportunity scenarios must be 0");
  }
  return counts;
}

function materializeBoundedFhvSessionDatabase(path: string, targetBytes: number): void {
  const db = new Database(path);
  try {
    db.pragma("journal_mode = WAL");
    db.exec("CREATE TABLE IF NOT EXISTS payload (id INTEGER PRIMARY KEY, blob BLOB NOT NULL)");
    const insert = db.prepare("INSERT INTO payload (blob) VALUES (?)");
    const chunk = Buffer.alloc(1 << 20, 7);
    const rows = Math.max(1, Math.ceil(targetBytes / chunk.length));
    const insertMany = db.transaction((count: number) => {
      for (let index = 0; index < count; index += 1) {
        insert.run(chunk);
      }
    });
    insertMany(rows);
    db.pragma("wal_checkpoint(TRUNCATE)");
  } finally {
    db.close();
  }
}

function measureBoundedFhvCheckpointBytes(workRoot: string, sessionPath: string): number {
  const sample = measureFhvCheckpointSnapshotCost({
    sessionPath,
    workDir: join(workRoot, "checkpoint-work"),
  });
  return sample.sessionBytes;
}

async function readBundleCount(sql: postgres.Sql, organizationId: string): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count
    FROM trader_forecast_bundle_v2
    WHERE organization_id = ${organizationId}::uuid
  `;
  return Number(rows[0]?.count ?? 0);
}

async function insertBulkCompleteBundlesWithProgress(
  sql: postgres.Sql,
  organizationId: string,
  packageId: string,
  startIndex: number,
  count: number,
  context: {
    chunkIndex: number;
    diagnostic: A3Phase01DiagnosticContextV1 | null;
    progressRecord: A3Phase01ProgressRecordV1 | null;
  },
): Promise<A3Phase01ProgressRecordV1 | null> {
  const insertPromise = insertBulkCompleteBundles(
    sql,
    organizationId,
    packageId,
    startIndex,
    count,
  );
  let progress = context.progressRecord;
  await waitForBulkBundleInsertWithProgress(sql, insertPromise, {
    startIndex,
    chunkCount: count,
    chunkIndex: context.chunkIndex,
    diagnostic: context.diagnostic,
    progressRecord: progress,
    onProgress: (next) => {
      progress = next;
    },
  });
  if (progress && context.diagnostic) {
    const committed = startIndex + count;
    progress = advanceA3Phase01ChunkProgress(progress, {
      chunkIndex: context.chunkIndex,
      committedBundleCount: committed,
      event: "COMMIT",
    });
    writeA3Phase01ProgressRecordAtomic(progress);
    appendA3DiagnosticLog(
      `[POPULATING_BUNDLES] COMMITTED_COUNT=${committed}`,
      context.diagnostic.logPath,
    );
  }
  return progress;
}

export function measureA3Phase03CheckpointIndependence(input: {
  n1Bundles: number;
  n2Bundles: number;
}): ForecastV2Phase3NIndependenceProof {
  const root = mkdtempSync(join(tmpdir(), "forecast-v2-storage-phase3-"));
  try {
    const sessionPath = join(root, "fhv-bounded-session.sqlite");
    materializeBoundedFhvSessionDatabase(sessionPath, PHASE3_BOUNDED_FHV_SESSION_BYTES);
    const checkpointSessionBytes = statSync(sessionPath).size;
    const checkpointBytesAtN1 = measureBoundedFhvCheckpointBytes(root, sessionPath);
    const checkpointBytesAtN2 = measureBoundedFhvCheckpointBytes(root, sessionPath);
    return measurePhase3CheckpointNIndependenceProof({
      n1Bundles: input.n1Bundles,
      n2Bundles: input.n2Bundles,
      checkpointBytesAtN1,
      checkpointBytesAtN2,
      checkpointSessionBytes,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function measurePhase3CheckpointNIndependenceProof(input: {
  n1Bundles: number;
  n2Bundles: number;
  checkpointBytesAtN1: number;
  checkpointBytesAtN2: number;
  checkpointSessionBytes: number;
}): ForecastV2Phase3NIndependenceProof {
  const bounded =
    input.checkpointBytesAtN1 === input.checkpointBytesAtN2 &&
    input.checkpointBytesAtN1 > 0 &&
    input.checkpointBytesAtN1 <= FHV_CHECKPOINT_SUPPORTED_ENVELOPE_BYTES &&
    FHV_THROUGHPUT_MAX_GROWTH_BYTES_PER_CYCLE <= 160;

  const evidence = [
    `n1_bundles=${input.n1Bundles}`,
    `n2_bundles=${input.n2Bundles}`,
    `checkpoint_bytes_at_n1=${input.checkpointBytesAtN1}`,
    `checkpoint_bytes_at_n2=${input.checkpointBytesAtN2}`,
    `checkpoint_session_bytes=${input.checkpointSessionBytes}`,
    `max_growth_bytes_per_cycle=${FHV_THROUGHPUT_MAX_GROWTH_BYTES_PER_CYCLE}`,
    `supported_checkpoint_envelope_bytes=${FHV_CHECKPOINT_SUPPORTED_ENVELOPE_BYTES}`,
    "forecast_v2_bundle_history_persisted_in_postgres_only",
    "fhv_hot_checkpoint_sqlite_independent_of_forecast_bundle_N",
  ].join("; ");

  return {
    n1Bundles: input.n1Bundles,
    n2Bundles: input.n2Bundles,
    checkpointBytesAtN1: input.checkpointBytesAtN1,
    checkpointBytesAtN2: input.checkpointBytesAtN2,
    checkpointSessionBytes: input.checkpointSessionBytes,
    maxGrowthBytesPerCycle: FHV_THROUGHPUT_MAX_GROWTH_BYTES_PER_CYCLE,
    supportedCheckpointEnvelopeBytes: FHV_CHECKPOINT_SUPPORTED_ENVELOPE_BYTES,
    bundleHistoryInFhvHotCheckpointPath: false,
    bounded,
    evidence,
  };
}

async function insertBulkCompleteBundles(
  sql: postgres.Sql,
  organizationId: string,
  packageId: string,
  startIndex: number,
  count: number,
): Promise<void> {
  await sql.unsafe(
    `
    WITH inserted_bundles AS (
      INSERT INTO trader_forecast_bundle_v2 (
        id, organization_id, predictive_package_id, run_id, cycle_id, symbol,
        anchor_closed_bar_epoch_ms, completeness_state, bundle_content_digest, schema_version
      )
      SELECT
        ('00000000-0000-4000-8000-' || lpad(to_hex(gs), 12, '0'))::uuid,
        $1::uuid,
        $2::uuid,
        'storage-scale-run',
        gs::text,
        'BTCUSDT',
        1700000000000 + gs,
        'COMPLETE',
        decode($3, 'hex'),
        1
      FROM generate_series($4::bigint, $5::bigint) AS gs
      RETURNING id, organization_id, cycle_id::bigint AS gs
    ),
    terminal_forecasts AS (
      INSERT INTO trader_forecast_v2 (
        id, organization_id, bundle_id, target_role_id, forecast_generation_identity_digest,
        forecast_content_digest, distribution_semantic_digest, k_config_dec, m_config_dec, s_dec,
        schema_version
      )
      SELECT
        ('00000000-0000-4000-8001-' || lpad(to_hex(b.gs), 12, '0'))::uuid,
        b.organization_id,
        b.id,
        'TERMINAL_RETURN',
        decode($3, 'hex'), decode($3, 'hex'), decode($3, 'hex'),
        10, 20, 200, 2
      FROM inserted_bundles b
      RETURNING id, organization_id, bundle_id
    ),
    exec_forecasts AS (
      INSERT INTO trader_forecast_v2 (
        id, organization_id, bundle_id, target_role_id, forecast_generation_identity_digest,
        forecast_content_digest, distribution_semantic_digest, k_config_dec, m_config_dec, s_dec,
        schema_version
      )
      SELECT
        ('00000000-0000-4000-8002-' || lpad(to_hex(b.gs), 12, '0'))::uuid,
        b.organization_id,
        b.id,
        'EXECUTION_OPPORTUNITY',
        decode($3, 'hex'), decode($3, 'hex'), decode($3, 'hex'),
        10, 20, 200, 2
      FROM inserted_bundles b
      RETURNING id, organization_id, bundle_id
    ),
    terminal_outcomes AS (
      INSERT INTO trader_forecast_outcome_v2 (
        organization_id, bundle_id, forecast_id, target_role_id, resolved_at,
        outcome_class, observed_outcome_digest, content_digest, schema_version
      )
      SELECT
        f.organization_id, f.bundle_id, f.id, 'TERMINAL_RETURN',
        TIMESTAMPTZ '2024-01-01', 'RESOLVED',
        decode($3, 'hex'), decode($3, 'hex'), 4
      FROM terminal_forecasts f
      JOIN inserted_bundles b ON b.id = f.bundle_id
    ),
    exec_outcomes AS (
      INSERT INTO trader_forecast_outcome_v2 (
        organization_id, bundle_id, forecast_id, target_role_id, resolved_at,
        outcome_class, observed_outcome_digest, content_digest, schema_version
      )
      SELECT
        f.organization_id, f.bundle_id, f.id, 'EXECUTION_OPPORTUNITY',
        TIMESTAMPTZ '2024-01-01', 'RESOLVED',
        decode($3, 'hex'), decode($3, 'hex'), 4
      FROM exec_forecasts f
      JOIN inserted_bundles b ON b.id = f.bundle_id
    ),
    terminal_calibration AS (
      INSERT INTO trader_forecast_calibration_observation_v2 (
        organization_id, bundle_id, forecast_id, target_role_id, scoring_eligible,
        content_digest, schema_version
      )
      SELECT
        f.organization_id, f.bundle_id, f.id, 'TERMINAL_RETURN', true,
        decode($3, 'hex'), 5
      FROM terminal_forecasts f
      JOIN inserted_bundles b ON b.id = f.bundle_id
    ),
    exec_calibration AS (
      INSERT INTO trader_forecast_calibration_observation_v2 (
        organization_id, bundle_id, forecast_id, target_role_id, scoring_eligible,
        content_digest, schema_version
      )
      SELECT
        f.organization_id, f.bundle_id, f.id, 'EXECUTION_OPPORTUNITY', true,
        decode($3, 'hex'), 5
      FROM exec_forecasts f
      JOIN inserted_bundles b ON b.id = f.bundle_id
    )
    INSERT INTO trader_forecast_scenario_v2 (
      organization_id, forecast_id, scenario_ordinal, probability_scale8,
      lower_bound_scale8, upper_bound_scale8, content_digest, schema_version
    )
    SELECT
      f.organization_id, f.id, s.scenario_ordinal,
      14285714,
      (s.scenario_ordinal * 100000000)::bigint,
      ((s.scenario_ordinal + 1) * 100000000)::bigint,
      decode($3, 'hex'), 3
    FROM terminal_forecasts f
    JOIN inserted_bundles b ON b.id = f.bundle_id
    CROSS JOIN generate_series(0, 6) AS s(scenario_ordinal);
    `,
    [organizationId, packageId, DIGEST, startIndex, startIndex + count - 1],
  );
}

async function insertWorstCasePackageCell(
  sql: postgres.Sql,
  organizationId: string,
  symbol: string,
  horizon: number,
): Promise<string> {
  const packageId = randomUUID();
  await sql`
    INSERT INTO trader_forecast_predictive_package_v2 (
      id, organization_id, venue, market, symbol, primary_horizon_minutes,
      execution_horizon_minutes, model_transform_version, replica_root_family_identity_digest,
      predictive_package_generation_identity_digest, predictive_package_content_digest,
      k_config_dec, m_config_dec, alpha_epi_config_scale8, km_global_anchor_set_digest,
      development_dataset_digest, feature_version, sampler_contract_version, quantizer_version,
      normalization_version_digest, runtime_contract_digest, package_subject_version,
      schema_version, idempotency_key
    ) VALUES (
      ${packageId}::uuid, ${organizationId}::uuid, 'htx', 'spot', ${symbol}, ${horizon}, 33,
      'rv-state-conditional-empirical-joint/v1', ${DIGEST}, ${DIGEST}, ${DIGEST},
      50, 80, '0.10000000', ${DIGEST}, ${DIGEST}, 'feature-engine/rv/v2',
      'waia-cbrng/sha256-ctr/v1', 'quantizeScale8HalfUp/v1', ${DIGEST}, ${DIGEST},
      'pkg-subject/v1', 'predictive-package/v2', ${randomUUID()}
    )
  `;

  const targetTerminalId = randomUUID();
  const targetExecId = randomUUID();
  await sql`
    INSERT INTO trader_forecast_target_definition_v2 (
      id, organization_id, venue, market, symbol, primary_horizon_minutes,
      target_role_id, representation_kind, component_layout_version,
      target_definition_digest, schema_version, idempotency_key
    ) VALUES
      (${targetTerminalId}::uuid, ${organizationId}::uuid, 'htx', 'spot', ${symbol}, ${horizon}, 'TERMINAL_RETURN', 'DISCRETE_SCENARIO', 'exec-opp-13d-v1', ${DIGEST}, 'target-definition/v2', ${randomUUID()}),
      (${targetExecId}::uuid, ${organizationId}::uuid, 'htx', 'spot', ${symbol}, ${horizon}, 'EXECUTION_OPPORTUNITY', 'SAMPLE_ENSEMBLE', 'exec-opp-13d-v1', ${DIGEST}, 'target-definition/v2', ${randomUUID()})
  `;

  for (let bucket = 0; bucket < 7; bucket += 1) {
    await sql`
      INSERT INTO trader_forecast_target_bucket_v2 (
        id, organization_id, target_definition_id, bucket_ordinal, bucket_label,
        lower_bound_scale8, upper_bound_scale8, content_digest, schema_version, idempotency_key
      ) VALUES (
        ${randomUUID()}::uuid, ${organizationId}::uuid, ${targetTerminalId}::uuid, ${bucket},
        ${`B${bucket}`}, ${`${bucket}.00000000`}, ${`${bucket + 1}.00000000`},
        ${DIGEST}, 'target-bucket/v2', ${randomUUID()}
      )
    `;
  }

  const bootstrapRoot = Buffer.alloc(32, 0xcd);
  for (let replicaOrdinal = 0; replicaOrdinal < 50; replicaOrdinal += 1) {
    const payload = buildA3IncompressibleReplicaPayloadV1({
      symbol,
      primaryHorizonMinutes: horizon,
      replicaOrdinal,
    });
    await sql`
      INSERT INTO trader_forecast_replica_artifact_v2 (
        id, organization_id, predictive_package_id, replica_ordinal, bootstrap_root,
        replica_artifact_digest, l_block_dec, artifact_payload, schema_version, idempotency_key
      ) VALUES (
        ${randomUUID()}::uuid,
        ${organizationId}::uuid,
        ${packageId}::uuid,
        ${replicaOrdinal},
        ${bootstrapRoot},
        ${DIGEST},
        4,
        ${payload},
        'replica-artifact/v2',
        ${`${symbol}:${horizon}:replica:${replicaOrdinal}`}
      )
    `;
  }

  await sql`
    INSERT INTO trader_forecast_predictive_package_target_v2 (
      id, organization_id, predictive_package_id, target_definition_id, target_role_id,
      binding_digest, schema_version, idempotency_key
    ) VALUES
      (${randomUUID()}::uuid, ${organizationId}::uuid, ${packageId}::uuid, ${targetTerminalId}::uuid, 'TERMINAL_RETURN', ${DIGEST}, 'package-target/v2', ${randomUUID()}),
      (${randomUUID()}::uuid, ${organizationId}::uuid, ${packageId}::uuid, ${targetExecId}::uuid, 'EXECUTION_OPPORTUNITY', ${DIGEST}, 'package-target/v2', ${randomUUID()})
  `;
  return packageId;
}

export async function insertA3FourCellPackageSurface(
  sql: postgres.Sql,
  organizationId: string,
): Promise<string> {
  let bundlePackageId = "";
  for (const symbol of ["BTCUSDT", "ETHUSDT"]) {
    for (const horizon of [30, 60]) {
      const packageId = await insertWorstCasePackageCell(sql, organizationId, symbol, horizon);
      if (symbol === "BTCUSDT" && horizon === 30) {
        bundlePackageId = packageId;
      }
    }
  }
  if (!bundlePackageId) {
    throw new Error("[forecast-v2/storage-scale] missing BTCUSDT/30m package for bundle FK");
  }
  return bundlePackageId;
}

export type ForecastV2StorageScalePhase01Result = {
  postgresServerVersion: string;
  appliedMigrationRange: { min: number; max: number; count: number };
  postgresMeasurementEnvironment: A3PostgresMeasurementEnvironmentV1;
  expectedPackageSurfaceDigestHex: string;
  observedPackageSurface: A3ObservedPackageSurfaceProofV1;
  b0Bytes: number;
  phase01PackageFixedBytes: number;
  packageFixedRelationBreakdown: ForecastV2RelationSizeBreakdown[];
  b1Bytes: number;
  b0RelationBreakdown: ForecastV2RelationSizeBreakdown[];
  b1RelationBreakdown: ForecastV2RelationSizeBreakdown[];
  rowCounts: Record<string, number>;
  /** @deprecated use phase01PackageFixedBytes */
  packageFixedPopulationBytesInPhase01: number;
};

export async function runForecastV2StorageScalePhase01(
  sql: postgres.Sql,
  organizationId: string,
  nBundles: number,
  repoRoot: string = process.cwd(),
  diagnosticOverrides?: Partial<A3Phase01DiagnosticContextV1>,
): Promise<ForecastV2StorageScalePhase01Result> {
  const chunkSize = 50_000;
  const targetChunkCount = Math.max(1, Math.ceil(nBundles / chunkSize));
  // Dynamic import avoids static cycle with a3-storage-contract-v1 (tables inventory).
  const identity = await import("./a3-storage-contract-v1");
  const diagnostic: A3Phase01DiagnosticContextV1 = {
    runId: diagnosticOverrides?.runId ?? process.env.A3_RUN_ID?.trim() ?? "A3-P01-UNSPECIFIED",
    canonicalContractDigest:
      diagnosticOverrides?.canonicalContractDigest ??
      identity.computeA3CanonicalContractDigestHex(),
    storageSurfaceDigest:
      diagnosticOverrides?.storageSurfaceDigest ??
      identity.computeStorageSurfaceDigestHex(repoRoot),
    phase01ImplementationDigest:
      diagnosticOverrides?.phase01ImplementationDigest ??
      identity.computePhase01ImplementationDigestHex(repoRoot),
    targetChunkCount: diagnosticOverrides?.targetChunkCount ?? targetChunkCount,
    logPath: diagnosticOverrides?.logPath ?? process.env.A3_LOG_PATH?.trim() ?? null,
  };
  let progress: A3Phase01ProgressRecordV1 | null = createInitialA3Phase01ProgressRecord(diagnostic);
  writeA3Phase01ProgressRecordAtomic(progress);
  appendA3DiagnosticLog("[BOOTSTRAP] start", diagnostic.logPath);

  const onAbortSignal = (signal: NodeJS.Signals) => {
    appendA3DiagnosticLog(
      `[SIGNAL] received=${signal} pid=${process.pid} ppid=${process.ppid ?? "n/a"}`,
      diagnostic.logPath,
    );
    if (progress) {
      progress = markA3Phase01ProgressTerminal(progress, "ABNORMAL_ABORT");
      writeA3Phase01ProgressRecordAtomic(progress);
    }
  };
  process.once("SIGTERM", onAbortSignal);
  process.once("SIGINT", onAbortSignal);

  try {
    await assertA3Phase01StageHealthy(sql, "BOOTSTRAP");
    const postgresMeasurementEnvironment = await capturePostgresMeasurementEnvironment(
      sql,
      repoRoot,
    );
    const postgresServerVersion = postgresMeasurementEnvironment.serverVersion;
    const appliedMigrationRange = await assertForecastV2MigrationRange(sql, repoRoot);
    await assertForecastV2TablesEmpty(sql);

    await sql`SET synchronous_commit = off`;
    await sql`SET work_mem = '4MB'`;

    const b0RelationBreakdown = await measureForecastV2RelationBreakdown(sql);
    const b0Bytes = b0RelationBreakdown.reduce((acc, row) => acc + row.totalBytes, 0);
    appendA3DiagnosticLog(`[B0] complete bytes=${b0Bytes}`, diagnostic.logPath);

    progress = {
      ...progress,
      stage: "INSERT_FIXED_PACKAGE",
      lastMeaningfulProgressUtc: new Date().toISOString(),
    };
    writeA3Phase01ProgressRecordAtomic(progress);
    appendA3DiagnosticLog("[INSERT_FIXED_PACKAGE] start", diagnostic.logPath);
    await assertA3Phase01StageHealthy(sql, "INSERT_FIXED_PACKAGE");
    await insertA3FourCellPackageSurface(sql, organizationId);
    appendA3DiagnosticLog("[INSERT_FIXED_PACKAGE] complete", diagnostic.logPath);
    const observedPackageSurface = await queryObservedPackageSurfaceProof(sql, organizationId);
    assertObservedPackageSurfaceProof(observedPackageSurface);
    appendA3DiagnosticLog(
      `[OBSERVED_PACKAGE_PROOF] complete digest=${observedPackageSurface.observedPackageSurfaceDigestHex}`,
      diagnostic.logPath,
    );

    const packageFixedRelationBreakdown = await measurePackageFixedRelationBreakdown(sql);
    const phase01PackageFixedBytes = packageFixedRelationBreakdown.reduce(
      (acc, row) => acc + row.totalBytes,
      0,
    );
    const bundlePackageId = (
      await sql<{ id: string }[]>`
      SELECT id::text AS id
      FROM trader_forecast_predictive_package_v2
      WHERE organization_id = ${organizationId}::uuid
        AND symbol = 'BTCUSDT'
        AND primary_horizon_minutes = 30
      LIMIT 1
    `
    )[0]?.id;
    if (!bundlePackageId) {
      throw new Error("[forecast-v2/storage-scale] missing BTCUSDT/30m package for bundle FK");
    }

    let chunkIndex = 0;
    for (let offset = 0; offset < nBundles; offset += chunkSize) {
      const count = Math.min(chunkSize, nBundles - offset);
      progress = await insertBulkCompleteBundlesWithProgress(
        sql,
        organizationId,
        bundlePackageId,
        offset,
        count,
        { chunkIndex, diagnostic, progressRecord: progress },
      );
      chunkIndex += 1;
    }

    progress = {
      ...(progress ?? createInitialA3Phase01ProgressRecord(diagnostic)),
      stage: "VACUUM_ANALYZE",
      lastMeaningfulProgressUtc: new Date().toISOString(),
    };
    writeA3Phase01ProgressRecordAtomic(progress);
    appendA3DiagnosticLog("[VACUUM] start", diagnostic.logPath);
    await assertA3Phase01StageHealthy(sql, "VACUUM_ANALYZE");
    await sql`VACUUM (ANALYZE)`;
    appendA3DiagnosticLog("[VACUUM] complete", diagnostic.logPath);

    progress = {
      ...progress,
      stage: "CHECKPOINT",
      lastMeaningfulProgressUtc: new Date().toISOString(),
    };
    writeA3Phase01ProgressRecordAtomic(progress);
    appendA3DiagnosticLog("[CHECKPOINT] start", diagnostic.logPath);
    await assertA3Phase01StageHealthy(sql, "CHECKPOINT");
    await sql`CHECKPOINT`;
    appendA3DiagnosticLog("[CHECKPOINT] complete", diagnostic.logPath);

    progress = {
      ...progress,
      stage: "MEASURING_B1",
      lastMeaningfulProgressUtc: new Date().toISOString(),
    };
    writeA3Phase01ProgressRecordAtomic(progress);
    appendA3DiagnosticLog("[B1] start", diagnostic.logPath);
    await assertA3Phase01StageHealthy(sql, "MEASURING_B1");
    const rowCounts = await assertExactBundleRowCounts(sql, organizationId, nBundles);
    const b1RelationBreakdown = await measureForecastV2RelationBreakdown(sql);
    const b1Bytes = b1RelationBreakdown.reduce((acc, row) => acc + row.totalBytes, 0);
    appendA3DiagnosticLog(`[B1] complete bytes=${b1Bytes}`, diagnostic.logPath);

    progress = markA3Phase01ProgressTerminal(progress, "NORMAL_COMPLETE");
    writeA3Phase01ProgressRecordAtomic(progress);
    appendA3DiagnosticLog("[PHASE01] TERMINAL NORMAL_COMPLETE", diagnostic.logPath);

    return {
      postgresServerVersion,
      appliedMigrationRange,
      postgresMeasurementEnvironment,
      expectedPackageSurfaceDigestHex: observedPackageSurface.expectedPackageSurfaceDigestHex,
      observedPackageSurface,
      b0Bytes,
      phase01PackageFixedBytes,
      packageFixedRelationBreakdown,
      b1Bytes,
      b0RelationBreakdown,
      b1RelationBreakdown,
      rowCounts,
      packageFixedPopulationBytesInPhase01: phase01PackageFixedBytes,
    };
  } catch (error) {
    if (progress) {
      progress = markA3Phase01ProgressTerminal(progress, "FAILED");
      writeA3Phase01ProgressRecordAtomic(progress);
    }
    appendA3DiagnosticLog(
      `[PHASE01] TERMINAL FAILED reason=${error instanceof Error ? error.message : String(error)}`,
      diagnostic.logPath,
    );
    throw error;
  } finally {
    process.off("SIGTERM", onAbortSignal);
    process.off("SIGINT", onAbortSignal);
  }
}

function statSyncSessionBytes(path: string): number {
  return statSync(path).size;
}

export type ForecastV2StorageScalePhase02Result = {
  postgresMeasurementEnvironment: A3PostgresMeasurementEnvironmentV1;
  expectedPackageSurfaceDigestHex: string;
  observedPackageSurface: A3ObservedPackageSurfaceProofV1;
  phase2EmptyBytes: number;
  phase2FullBytes: number;
  phase2RelationBreakdown: ForecastV2RelationSizeBreakdown[];
  packageFixedRelationBreakdown: ForecastV2RelationSizeBreakdown[];
  packageFixedContributionBytes: number;
  enumeratedFixedV2OtherItems: ForecastV2FixedV2ClassificationItem[];
  enumeratedFixedV2OtherBytes: number;
};

export async function runForecastV2StorageScalePhase02(
  sql: postgres.Sql,
  organizationId: string,
  repoRoot: string = process.cwd(),
): Promise<ForecastV2StorageScalePhase02Result> {
  await assertForecastV2TablesEmpty(sql);
  const postgresMeasurementEnvironment = await capturePostgresMeasurementEnvironment(sql, repoRoot);

  const phase2EmptyRelationBreakdown = await measureForecastV2RelationBreakdown(sql);
  const phase2EmptyBytes = phase2EmptyRelationBreakdown.reduce(
    (acc, row) => acc + row.totalBytes,
    0,
  );

  await insertA3FourCellPackageSurface(sql, organizationId);
  const observedPackageSurface = await queryObservedPackageSurfaceProof(sql, organizationId);
  assertObservedPackageSurfaceProof(observedPackageSurface);

  const packageFixedRelationBreakdown = await measurePackageFixedRelationBreakdown(sql);
  const packageFixedContributionBytes = packageFixedRelationBreakdown.reduce(
    (acc, row) => acc + row.totalBytes,
    0,
  );
  const phase2FullRelationBreakdown = await measureForecastV2RelationBreakdown(sql);
  const phase2FullBytes = phase2FullRelationBreakdown.reduce((acc, row) => acc + row.totalBytes, 0);
  const { items, enumeratedFixedV2OtherBytes } = await measureEnumeratedFixedV2OtherEvidence(sql);

  return {
    postgresMeasurementEnvironment,
    expectedPackageSurfaceDigestHex: observedPackageSurface.expectedPackageSurfaceDigestHex,
    observedPackageSurface,
    phase2EmptyBytes,
    phase2FullBytes,
    phase2RelationBreakdown: phase2FullRelationBreakdown,
    packageFixedRelationBreakdown,
    packageFixedContributionBytes,
    enumeratedFixedV2OtherItems: items,
    enumeratedFixedV2OtherBytes,
  };
}

export async function runForecastV2StorageScalePostgresV1(input: {
  sql: postgres.Sql;
  organizationId: string;
  nBundles?: number;
  recreateFreshDatabase: () => Promise<{ sql: postgres.Sql; organizationId: string }>;
}): Promise<ForecastV2StorageScaleMeasuredReceipt> {
  const nBundles = input.nBundles ?? 200_000;

  const phase01 = await runForecastV2StorageScalePhase01(input.sql, input.organizationId, nBundles);

  await input.sql.end({ timeout: 30 });

  const fresh = await input.recreateFreshDatabase();
  const phase02 = await runForecastV2StorageScalePhase02(fresh.sql, fresh.organizationId);

  const { items: enumeratedFixedV2OtherItems, enumeratedFixedV2OtherBytes } =
    await measureEnumeratedFixedV2OtherEvidence(fresh.sql);

  const formulaPopulationIdentity: ForecastV2FormulaPopulationIdentity = {
    proven:
      phase01.phase01PackageFixedBytes === phase02.packageFixedContributionBytes &&
      phase01.observedPackageSurface.observedPackageSurfaceDigestHex ===
        phase02.observedPackageSurface.observedPackageSurfaceDigestHex,
    phase1SeedPackageRows: {
      predictivePackages: 4,
      targetDefinitions: 8,
      targetBuckets: 28,
      packageTargets: 8,
      replicaArtifacts: 200,
    },
    phase2WorstCaseRowsPerCell: {
      predictivePackages: 1,
      targetDefinitions: 2,
      targetBuckets: 7,
      packageTargets: 2,
      replicaArtifacts: 50,
    },
    phase1SeedPackageContributionBytes: phase01.phase01PackageFixedBytes,
    phase2PackageFixedContributionBytes: phase02.packageFixedContributionBytes,
    reconciliationNote:
      "Non-authoritative diagnostic only; authoritative phased aggregate requires exact package-fixed byte equality and matching observed package surface digests.",
  };

  const bytesPerCompleteBundle = Math.ceil(
    (phase01.b1Bytes - phase01.b0Bytes - phase02.packageFixedContributionBytes) / nBundles,
  );

  const totalProjectedBytes = computeForecastV2TotalProjectedBytes({
    bytesPerCompleteBundle,
    packageFixedContributionBytes: phase02.packageFixedContributionBytes,
    enumeratedFixedV2OtherBytes,
  });

  const evaluated = evaluateForecastV2StorageScaleReceipt({
    bytesPerCompleteBundle,
    packageFixedContributionBytes: phase02.packageFixedContributionBytes,
    enumeratedFixedV2OtherBytes,
  });

  const perSampleTables = await fresh.sql<{ relname: string }[]>`
    SELECT relname FROM pg_class
    WHERE relname ILIKE '%exec_sample%' OR relname ILIKE '%forecast_exec_sample%'
  `;

  const phase3NIndependenceProof = measureA3Phase03CheckpointIndependence({
    n1Bundles: A3_PHASE3_N1_BUNDLES,
    n2Bundles: nBundles,
  });

  const failureReasons = [...evaluated.failureReasons];
  if (phase01.phase01PackageFixedBytes !== phase02.packageFixedContributionBytes) {
    failureReasons.push(DEE_518_BLOCKED_PACKAGE_FIXED_BYTE_IDENTITY_RECONCILIATION_REQUIRED);
  }
  if (perSampleTables.length > 0) {
    failureReasons.push("per-sample relational table exists");
  }
  if (!phase3NIndependenceProof.bounded) {
    failureReasons.push("phase3 N-independence checkpoint boundedness proof failed");
  }
  if (!formulaPopulationIdentity.proven) {
    failureReasons.push("STORAGE_FORMULA_CANON_RECONCILIATION_REQUIRED");
  }

  await fresh.sql.end({ timeout: 30 });

  return {
    schemaVersion: "forecast-v2-storage-scale-measured-receipt/v1",
    postgresServerVersion: phase01.postgresServerVersion,
    appliedMigrationRange: phase01.appliedMigrationRange,
    nBundles,
    b0Bytes: phase01.b0Bytes,
    b1Bytes: phase01.b1Bytes,
    b0RelationBreakdown: phase01.b0RelationBreakdown,
    b1RelationBreakdown: phase01.b1RelationBreakdown,
    rowCounts: phase01.rowCounts,
    bytesPerCompleteBundle,
    phase2FreshDatabaseLiteral: true,
    phase2EmptyBytes: phase02.phase2EmptyBytes,
    phase2FullBytes: phase02.phase2FullBytes,
    phase2RelationBreakdown: phase02.phase2RelationBreakdown,
    packageFixedContributionBytes: phase02.packageFixedContributionBytes,
    packageRawReplicaPayloadBytes: FORECAST_V2_PACKAGE_REPLICA_PAYLOAD_BYTES * 4,
    enumeratedFixedV2OtherItems,
    enumeratedFixedV2OtherBytes,
    formulaPopulationIdentity,
    totalProjectedBytes,
    phase3HotCheckpointBounded: phase3NIndependenceProof.bounded,
    phase3NIndependenceProof,
    pass: failureReasons.length === 0,
    failureReasons,
  };
}

export async function cleanupForecastV2StorageRows(
  sql: postgres.Sql,
  organizationId: string,
): Promise<void> {
  if (!organizationId) {
    throw new Error("[forecast-v2/storage-scale] cleanup requires organizationId");
  }
  const tables = [
    "trader_forecast_scenario_v2",
    "trader_forecast_calibration_observation_v2",
    "trader_forecast_outcome_v2",
    "trader_forecast_v2",
    "trader_forecast_bundle_v2",
    "trader_forecast_replica_artifact_v2",
    "trader_forecast_predictive_package_target_v2",
    "trader_forecast_target_bucket_v2",
    "trader_forecast_target_definition_v2",
    "trader_forecast_predictive_package_v2",
  ];
  // Test-only cleanup: replica role bypasses USER append-only triggers atomically.
  await sql.unsafe(`SET session_replication_role = replica`);
  try {
    for (const table of tables) {
      await sql.unsafe(`DELETE FROM ${table} WHERE organization_id = $1`, [organizationId]);
    }
  } finally {
    await sql.unsafe(`SET session_replication_role = DEFAULT`);
  }
}

/** @deprecated Prefer collectPostgresBlockingLockDiagnostics — IO waits are not blockers. */
export async function collectPostgresLockDiagnostics(
  sql: postgres.Sql,
  thresholdMs: number,
): Promise<string[]> {
  return collectPostgresBlockingLockDiagnostics(sql, thresholdMs);
}
