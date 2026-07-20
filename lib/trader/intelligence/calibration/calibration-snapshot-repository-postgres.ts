import { and, eq } from "drizzle-orm";

import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import * as pgSchema from "@/db/schema.postgres";
import { OutcomeResolutionIdempotencyConflictError } from "@/lib/trader/intelligence/outcome-resolution/errors";
import type {
  CalibrationPartitionKey,
  CalibrationSnapshotRecord,
} from "@/lib/trader/intelligence/calibration/calibration.types";
import { runIdempotentInsertWithSavepoint } from "@/lib/trader/intelligence/records/postgres-idempotent-insert";
import { orgScopedWhere, requireOrgContext } from "@/lib/waia-core/scope/org-context";

type PgExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "execute">;

function mapRow(
  row: typeof pgSchema.traderCalibrationSnapshotRecord.$inferSelect,
): CalibrationSnapshotRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    runId: row.runId,
    cycleId: row.cycleId,
    symbol: row.symbol,
    forecastModelVersion: row.forecastModelVersion,
    regime: row.regime,
    horizon: row.horizon,
    sampleCount: row.sampleCount,
    scoringSampleCount: row.scoringSampleCount,
    brierMean: row.brierMean,
    logLossMean: row.logLossMean,
    calibrationStatus: row.calibrationStatus as CalibrationSnapshotRecord["calibrationStatus"],
    calibrationWindow: row.calibrationWindow,
    survivorshipCountsJson: row.survivorshipCountsJson,
    issuedAt: row.issuedAt.toISOString(),
    eligibleResolutionAt: row.eligibleResolutionAt.toISOString(),
    resolvedAt: row.resolvedAt.toISOString(),
    pitEvidenceBoundary: row.pitEvidenceBoundary.toISOString(),
    outcomeClass: "SNAPSHOT",
    score: row.score,
    contentDigest: row.contentDigest,
    idempotencyKey: row.idempotencyKey,
    provenance: JSON.parse(row.provenanceJson) as CalibrationSnapshotRecord["provenance"],
    terminalReason: row.terminalReason,
    schemaVersion: row.schemaVersion as CalibrationSnapshotRecord["schemaVersion"],
  };
}

export function createCalibrationSnapshotRepositoryPostgres(ex: PgExecutor) {
  return {
    async findByPartition(
      context: { organizationId: string },
      runId: string,
      partition: CalibrationPartitionKey,
    ) {
      const scoped = requireOrgContext(context.organizationId);
      const rows = await ex
        .select()
        .from(pgSchema.traderCalibrationSnapshotRecord)
        .where(
          and(
            orgScopedWhere(pgSchema.traderCalibrationSnapshotRecord.organizationId, scoped),
            eq(pgSchema.traderCalibrationSnapshotRecord.runId, runId),
            eq(
              pgSchema.traderCalibrationSnapshotRecord.forecastModelVersion,
              partition.forecastModelVersion,
            ),
            eq(pgSchema.traderCalibrationSnapshotRecord.regime, partition.regime),
            eq(pgSchema.traderCalibrationSnapshotRecord.horizon, partition.horizon),
          ),
        )
        .limit(1);
      return rows[0] ? mapRow(rows[0]) : null;
    },

    async listForRun(context: { organizationId: string }, runId: string) {
      const scoped = requireOrgContext(context.organizationId);
      const rows = await ex
        .select()
        .from(pgSchema.traderCalibrationSnapshotRecord)
        .where(
          and(
            orgScopedWhere(pgSchema.traderCalibrationSnapshotRecord.organizationId, scoped),
            eq(pgSchema.traderCalibrationSnapshotRecord.runId, runId),
          ),
        );
      return rows.map(mapRow);
    },

    async insert(context: { organizationId: string }, record: CalibrationSnapshotRecord) {
      const scoped = requireOrgContext(context.organizationId);
      const existing = await this.findByPartition(context, record.runId, {
        forecastModelVersion: record.forecastModelVersion,
        regime: record.regime,
        horizon: record.horizon,
      });
      if (existing) {
        if (existing.contentDigest !== record.contentDigest) {
          throw new OutcomeResolutionIdempotencyConflictError(
            "calibration snapshot conflict with mismatched digest",
          );
        }
        return;
      }

      await runIdempotentInsertWithSavepoint(ex, "calibration_snapshot", async () => {
        await ex.insert(pgSchema.traderCalibrationSnapshotRecord).values({
          id: record.id,
          organizationId: scoped.organizationId,
          runId: record.runId,
          cycleId: record.cycleId,
          symbol: record.symbol,
          forecastModelVersion: record.forecastModelVersion,
          regime: record.regime,
          horizon: record.horizon,
          sampleCount: record.sampleCount,
          scoringSampleCount: record.scoringSampleCount,
          brierMean: record.brierMean,
          logLossMean: record.logLossMean,
          calibrationStatus: record.calibrationStatus,
          calibrationWindow: record.calibrationWindow,
          survivorshipCountsJson: record.survivorshipCountsJson,
          issuedAt: new Date(record.issuedAt),
          eligibleResolutionAt: new Date(record.eligibleResolutionAt),
          resolvedAt: new Date(record.resolvedAt),
          pitEvidenceBoundary: new Date(record.pitEvidenceBoundary),
          score: record.score,
          contentDigest: record.contentDigest,
          idempotencyKey: record.idempotencyKey,
          provenanceJson: JSON.stringify(record.provenance),
          terminalReason: record.terminalReason,
          schemaVersion: record.schemaVersion,
        });
      });
    },
  };
}
