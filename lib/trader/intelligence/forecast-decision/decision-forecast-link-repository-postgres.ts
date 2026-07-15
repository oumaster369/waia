import { and, eq } from "drizzle-orm";

import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import * as pgSchema from "@/db/schema.postgres";
import { ForecastDecisionIdempotencyConflictError } from "@/lib/trader/intelligence/forecast-decision/errors";
import type { TraderIntelligenceDecisionForecastLink } from "@/lib/trader/intelligence/forecast-decision/forecast-decision.types";
import type { DecisionForecastLinkRepository } from "@/lib/trader/intelligence/forecast-decision/forecast-decision-repository-adapters";
import { runIdempotentInsertWithSavepoint } from "@/lib/trader/intelligence/records/postgres-idempotent-insert";
import { orgScopedWhere, requireOrgContext } from "@/lib/waia-core/scope/org-context";

type PgExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "execute">;

function mapRow(
  row: typeof pgSchema.traderIntelligenceDecisionForecastLink.$inferSelect,
): TraderIntelligenceDecisionForecastLink {
  return {
    id: row.id,
    organizationId: row.organizationId,
    decisionRecordId: row.decisionRecordId,
    forecastRecordId: row.forecastRecordId,
    linkRole: row.linkRole as TraderIntelligenceDecisionForecastLink["linkRole"],
    ordinal: row.ordinal,
    contentDigest: row.contentDigest,
    schemaVersion: row.schemaVersion as TraderIntelligenceDecisionForecastLink["schemaVersion"],
  };
}

function assertIdempotentMatch(
  existing: TraderIntelligenceDecisionForecastLink,
  incoming: TraderIntelligenceDecisionForecastLink,
): void {
  if (
    existing.id !== incoming.id ||
    existing.organizationId !== incoming.organizationId ||
    existing.decisionRecordId !== incoming.decisionRecordId ||
    existing.forecastRecordId !== incoming.forecastRecordId ||
    existing.ordinal !== incoming.ordinal ||
    existing.schemaVersion !== incoming.schemaVersion ||
    existing.contentDigest !== incoming.contentDigest
  ) {
    throw new ForecastDecisionIdempotencyConflictError(
      "decision-forecast link business key conflict with mismatched identity or digest",
    );
  }
}

export function createDecisionForecastLinkRepositoryPostgres(
  ex: PgExecutor,
): DecisionForecastLinkRepository {
  return {
    async findByBusinessKey(context, key) {
      const scoped = requireOrgContext(context.organizationId);
      const rows = await ex
        .select()
        .from(pgSchema.traderIntelligenceDecisionForecastLink)
        .where(
          and(
            orgScopedWhere(pgSchema.traderIntelligenceDecisionForecastLink.organizationId, scoped),
            eq(
              pgSchema.traderIntelligenceDecisionForecastLink.decisionRecordId,
              key.decisionRecordId,
            ),
            eq(
              pgSchema.traderIntelligenceDecisionForecastLink.forecastRecordId,
              key.forecastRecordId,
            ),
          ),
        )
        .limit(1);
      return rows[0] ? mapRow(rows[0]) : null;
    },

    async insert(context, record) {
      const scoped = requireOrgContext(context.organizationId);
      const existing = await this.findByBusinessKey(context, {
        decisionRecordId: record.decisionRecordId,
        forecastRecordId: record.forecastRecordId,
      });
      if (existing) {
        assertIdempotentMatch(existing, record);
        return;
      }

      const insertResult = await runIdempotentInsertWithSavepoint(
        ex,
        "decision_forecast_link",
        async () => {
          await ex.insert(pgSchema.traderIntelligenceDecisionForecastLink).values({
            id: record.id,
            organizationId: scoped.organizationId,
            decisionRecordId: record.decisionRecordId,
            forecastRecordId: record.forecastRecordId,
            linkRole: record.linkRole,
            ordinal: record.ordinal,
            contentDigest: record.contentDigest,
            schemaVersion: record.schemaVersion,
          });
        },
      );

      if (insertResult === "unique_violation") {
        const raced = await this.findByBusinessKey(context, {
          decisionRecordId: record.decisionRecordId,
          forecastRecordId: record.forecastRecordId,
        });
        if (!raced) {
          throw new ForecastDecisionIdempotencyConflictError(
            "decision-forecast link conflict without existing row",
          );
        }
        assertIdempotentMatch(raced, record);
      }
    },
  };
}
