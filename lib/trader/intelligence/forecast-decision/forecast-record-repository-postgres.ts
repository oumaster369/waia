import { and, eq } from "drizzle-orm";

import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import * as pgSchema from "@/db/schema.postgres";
import { ForecastDecisionIdempotencyConflictError } from "@/lib/trader/intelligence/forecast-decision/errors";
import type { TraderIntelligenceForecastRecord } from "@/lib/trader/intelligence/forecast-decision/forecast-decision.types";
import type { ForecastRecordRepository } from "@/lib/trader/intelligence/forecast-decision/forecast-decision-repository-adapters";
import { assertForecastDecisionPersistencePermit } from "@/lib/trader/intelligence/forecast-decision/forecast-decision-construction-authority";
import { runIdempotentInsertWithSavepoint } from "@/lib/trader/intelligence/records/postgres-idempotent-insert";
import { orgScopedWhere, requireOrgContext } from "@/lib/waia-core/scope/org-context";

type PgExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "execute">;

function mapRow(
  row: typeof pgSchema.traderIntelligenceForecastRecord.$inferSelect,
): TraderIntelligenceForecastRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    cycleEnvelopeId: row.cycleEnvelopeId,
    hypothesisRecordId: row.hypothesisRecordId,
    convictionRecordId: row.convictionRecordId,
    runId: row.runId,
    cycleId: row.cycleId,
    symbol: row.symbol,
    forecastKeyDigest: row.forecastKeyDigest,
    evaluatedAt: row.evaluatedAt.toISOString(),
    issuedAt: row.issuedAt.toISOString(),
    evidenceCutoffAt: row.evidenceCutoffAt.toISOString(),
    targetWindowStartAt: row.targetWindowStartAt.toISOString(),
    targetWindowEndAt: row.targetWindowEndAt.toISOString(),
    marketQuestion: row.marketQuestion,
    invalidationConditionsJson: row.invalidationConditionsJson,
    scenarioSetJson: row.scenarioSetJson,
    forecastConfidenceJson: row.forecastConfidenceJson,
    historicalProfileId: row.historicalProfileId,
    historicalProfileDigest: row.historicalProfileDigest,
    matrixDigest: row.matrixDigest,
    evidenceDigest: row.evidenceDigest,
    authoritativeLinkDigest: row.authoritativeLinkDigest,
    canonicalCausalLineageJson: row.canonicalCausalLineageJson,
    canonicalCausalLineageDigest: row.canonicalCausalLineageDigest,
    forecastModelVersion: row.forecastModelVersion,
    contentDigest: row.contentDigest,
    schemaVersion: row.schemaVersion as TraderIntelligenceForecastRecord["schemaVersion"],
  };
}

function assertIdempotentMatch(
  existing: TraderIntelligenceForecastRecord,
  incoming: TraderIntelligenceForecastRecord,
): void {
  if (
    existing.id !== incoming.id ||
    existing.organizationId !== incoming.organizationId ||
    existing.runId !== incoming.runId ||
    existing.cycleId !== incoming.cycleId ||
    existing.symbol !== incoming.symbol ||
    existing.forecastKeyDigest !== incoming.forecastKeyDigest ||
    existing.schemaVersion !== incoming.schemaVersion ||
    existing.contentDigest !== incoming.contentDigest
    || existing.canonicalCausalLineageJson !== (incoming.canonicalCausalLineageJson ?? null)
    || existing.canonicalCausalLineageDigest !== (incoming.canonicalCausalLineageDigest ?? null)
  ) {
    throw new ForecastDecisionIdempotencyConflictError(
      "forecast record business key conflict with mismatched identity or digest",
    );
  }
}

export function createForecastRecordRepositoryPostgres(ex: PgExecutor): ForecastRecordRepository {
  return {
    async findByBusinessKey(context, key) {
      const scoped = requireOrgContext(context.organizationId);
      const rows = await ex
        .select()
        .from(pgSchema.traderIntelligenceForecastRecord)
        .where(
          and(
            orgScopedWhere(pgSchema.traderIntelligenceForecastRecord.organizationId, scoped),
            eq(pgSchema.traderIntelligenceForecastRecord.runId, key.runId),
            eq(pgSchema.traderIntelligenceForecastRecord.cycleId, key.cycleId),
            eq(pgSchema.traderIntelligenceForecastRecord.symbol, key.symbol),
            eq(pgSchema.traderIntelligenceForecastRecord.forecastKeyDigest, key.forecastKeyDigest),
          ),
        )
        .limit(1);
      return rows[0] ? mapRow(rows[0]) : null;
    },

    async insert(context, record, permit) {
      assertForecastDecisionPersistencePermit(permit, "FORECAST", record);
      const scoped = requireOrgContext(context.organizationId);
      const existing = await this.findByBusinessKey(context, {
        runId: record.runId,
        cycleId: record.cycleId,
        symbol: record.symbol,
        forecastKeyDigest: record.forecastKeyDigest,
      });
      if (existing) {
        assertIdempotentMatch(existing, record);
        return;
      }

      const insertResult = await runIdempotentInsertWithSavepoint(
        ex,
        "forecast_record",
        async () => {
          await ex.insert(pgSchema.traderIntelligenceForecastRecord).values({
            id: record.id,
            organizationId: scoped.organizationId,
            cycleEnvelopeId: record.cycleEnvelopeId,
            hypothesisRecordId: record.hypothesisRecordId,
            convictionRecordId: record.convictionRecordId,
            runId: record.runId,
            cycleId: record.cycleId,
            symbol: record.symbol,
            forecastKeyDigest: record.forecastKeyDigest,
            evaluatedAt: new Date(record.evaluatedAt),
            issuedAt: new Date(record.issuedAt),
            evidenceCutoffAt: new Date(record.evidenceCutoffAt),
            targetWindowStartAt: new Date(record.targetWindowStartAt),
            targetWindowEndAt: new Date(record.targetWindowEndAt),
            marketQuestion: record.marketQuestion,
            invalidationConditionsJson: record.invalidationConditionsJson,
            scenarioSetJson: record.scenarioSetJson,
            forecastConfidenceJson: record.forecastConfidenceJson,
            historicalProfileId: record.historicalProfileId,
            historicalProfileDigest: record.historicalProfileDigest,
            matrixDigest: record.matrixDigest,
            evidenceDigest: record.evidenceDigest,
            authoritativeLinkDigest: record.authoritativeLinkDigest,
            canonicalCausalLineageJson: record.canonicalCausalLineageJson ?? null,
            canonicalCausalLineageDigest: record.canonicalCausalLineageDigest ?? null,
            forecastModelVersion: record.forecastModelVersion,
            contentDigest: record.contentDigest,
            schemaVersion: record.schemaVersion,
          });
        },
      );

      if (insertResult === "unique_violation") {
        const raced = await this.findByBusinessKey(context, {
          runId: record.runId,
          cycleId: record.cycleId,
          symbol: record.symbol,
          forecastKeyDigest: record.forecastKeyDigest,
        });
        if (!raced) {
          throw new ForecastDecisionIdempotencyConflictError(
            "forecast record conflict without existing row",
          );
        }
        assertIdempotentMatch(raced, record);
      }
    },
  };
}
