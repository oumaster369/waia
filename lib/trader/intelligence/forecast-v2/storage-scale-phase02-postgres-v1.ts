/**
 * Authoritative A3 PHASE-02 package-fixed measurement entrypoint.
 *
 * Isolated from Phase-01 implementation digest surface
 * (`storage-scale-postgres-v1.ts` remains byte-stable for R5 binding).
 */

import type postgres from "postgres";

import {
  assertObservedPackageSurfaceProof,
  queryObservedPackageSurfaceProof,
} from "./a3-observed-package-surface-v1";
import { capturePostgresMeasurementEnvironment } from "./a3-postgres-measurement-environment-v1";
import { measureEnumeratedFixedV2OtherEvidenceV1 } from "./a3-storage-relation-classification-v1";
import {
  assertForecastV2TablesEmpty,
  FORECAST_V2_STORAGE_TABLES,
  insertA3FourCellPackageSurface,
  measurePackageFixedRelationBreakdown,
  type ForecastV2RelationSizeBreakdown,
  type ForecastV2StorageScalePhase02Result,
} from "./storage-scale-postgres-v1";

async function measureForecastV2RelationBreakdown(
  sql: postgres.Sql,
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
    WHERE c.relname = ANY(${FORECAST_V2_STORAGE_TABLES as unknown as string[]})
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

export type { ForecastV2StorageScalePhase02Result };

/**
 * Authoritative PHASE-02 runner for fully migrated application databases.
 * Research/global OUT OF SCOPE tables may exist; they do not contaminate
 * package_fixed / proportional / enumerated_fixed_V2_other unless injected.
 */
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
  const { items, enumeratedFixedV2OtherBytes } = await measureEnumeratedFixedV2OtherEvidenceV1(sql);

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
