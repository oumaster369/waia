import { and, eq } from "drizzle-orm";

import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import * as pgSchema from "@/db/schema.postgres";
import { OutcomeResolutionIdempotencyConflictError } from "@/lib/trader/intelligence/outcome-resolution/errors";
import type { CalibrationObservationRecord } from "@/lib/trader/intelligence/calibration/calibration.types";
import { runIdempotentInsertWithSavepoint } from "@/lib/trader/intelligence/records/postgres-idempotent-insert";
import { orgScopedWhere, requireOrgContext } from "@/lib/waia-core/scope/org-context";

type PgExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "execute">;

function mapRow(
  row: typeof pgSchema.traderCalibrationObservationRecord.$inferSelect,
): CalibrationObservationRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    runId: row.runId,
    cycleId: row.cycleId,
    symbol: row.symbol,
    forecastRecordId: row.forecastRecordId,
    forecastOutcomeId: row.forecastOutcomeId,
    modelVersion: row.modelVersion,
    strategyVersion: row.strategyVersion,
    regime: row.regime,
    horizon: row.horizon,
    issuedAt: row.issuedAt.toISOString(),
    eligibleResolutionAt: row.eligibleResolutionAt.toISOString(),
    resolvedAt: row.resolvedAt.toISOString(),
    pitEvidenceBoundary: row.pitEvidenceBoundary.toISOString(),
    probability: row.probability,
    outcomeEncoding: row.outcomeEncoding as CalibrationObservationRecord["outcomeEncoding"],
    brierScore: row.brierScore,
    logLossScore: row.logLossScore,
    scoringEligible: row.scoringEligible,
    nonScoringReason: row.nonScoringReason as CalibrationObservationRecord["nonScoringReason"],
    contentDigest: row.contentDigest,
    idempotencyKey: row.idempotencyKey,
    provenance: JSON.parse(row.provenanceJson) as CalibrationObservationRecord["provenance"],
    terminalReason: row.terminalReason,
    schemaVersion: row.schemaVersion as CalibrationObservationRecord["schemaVersion"],
  };
}

export function createCalibrationObservationRepositoryPostgres(ex: PgExecutor) {
  return {
    async findByForecastOutcomeId(context: { organizationId: string }, forecastOutcomeId: string) {
      const scoped = requireOrgContext(context.organizationId);
      const rows = await ex
        .select()
        .from(pgSchema.traderCalibrationObservationRecord)
        .where(
          and(
            orgScopedWhere(pgSchema.traderCalibrationObservationRecord.organizationId, scoped),
            eq(pgSchema.traderCalibrationObservationRecord.forecastOutcomeId, forecastOutcomeId),
          ),
        )
        .limit(1);
      return rows[0] ? mapRow(rows[0]) : null;
    },

    async listForRun(context: { organizationId: string }, runId: string) {
      const scoped = requireOrgContext(context.organizationId);
      const rows = await ex
        .select()
        .from(pgSchema.traderCalibrationObservationRecord)
        .where(
          and(
            orgScopedWhere(pgSchema.traderCalibrationObservationRecord.organizationId, scoped),
            eq(pgSchema.traderCalibrationObservationRecord.runId, runId),
          ),
        );
      return rows.map(mapRow);
    },

    async insert(context: { organizationId: string }, record: CalibrationObservationRecord) {
      const scoped = requireOrgContext(context.organizationId);
      const existing = await this.findByForecastOutcomeId(context, record.forecastOutcomeId);
      if (existing) {
        if (existing.contentDigest !== record.contentDigest) {
          throw new OutcomeResolutionIdempotencyConflictError(
            "calibration observation conflict with mismatched digest",
          );
        }
        return;
      }

      await runIdempotentInsertWithSavepoint(ex, "calibration_observation", async () => {
        await ex.insert(pgSchema.traderCalibrationObservationRecord).values({
          id: record.id,
          organizationId: scoped.organizationId,
          runId: record.runId,
          cycleId: record.cycleId,
          symbol: record.symbol,
          forecastRecordId: record.forecastRecordId,
          forecastOutcomeId: record.forecastOutcomeId,
          modelVersion: record.modelVersion,
          strategyVersion: record.strategyVersion,
          regime: record.regime,
          horizon: record.horizon,
          issuedAt: new Date(record.issuedAt),
          eligibleResolutionAt: new Date(record.eligibleResolutionAt),
          resolvedAt: new Date(record.resolvedAt),
          pitEvidenceBoundary: new Date(record.pitEvidenceBoundary),
          probability: record.probability,
          outcomeEncoding: record.outcomeEncoding,
          brierScore: record.brierScore,
          logLossScore: record.logLossScore,
          scoringEligible: record.scoringEligible,
          nonScoringReason: record.nonScoringReason,
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
