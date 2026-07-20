import { and, eq, lte } from "drizzle-orm";

import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import * as pgSchema from "@/db/schema.postgres";
import type {
  MkbReadModelQuery,
  OutcomeResolutionReadPort,
  OutcomeResolutionRow,
} from "@/lib/trader/knowledge/mkb-read-model.types";
import { orgScopedWhere, requireOrgContext } from "@/lib/waia-core/scope/org-context";

type PgExecutor = Pick<WaiaPostgresDb, "select">;

export function createOutcomeResolutionReadPortPostgres(ex: PgExecutor): OutcomeResolutionReadPort {
  return {
    async listResolvedOutcomes(context, asOf, query: MkbReadModelQuery) {
      const scoped = requireOrgContext(context.organizationId);
      const asOfDate = asOf;

      const conditions = [
        orgScopedWhere(pgSchema.traderForecastOutcomeRecord.organizationId, scoped),
        eq(pgSchema.traderForecastOutcomeRecord.outcomeClass, "RESOLVED"),
        lte(pgSchema.traderForecastOutcomeRecord.resolvedAt, asOfDate),
      ];

      if (query.runId) {
        conditions.push(eq(pgSchema.traderForecastOutcomeRecord.runId, query.runId));
      }
      if (query.cycleId) {
        conditions.push(eq(pgSchema.traderForecastOutcomeRecord.cycleId, query.cycleId));
      }
      if (query.symbol) {
        conditions.push(eq(pgSchema.traderForecastOutcomeRecord.symbol, query.symbol));
      }

      const rows = await ex
        .select()
        .from(pgSchema.traderForecastOutcomeRecord)
        .where(and(...conditions));

      const mapped: OutcomeResolutionRow[] = rows
        .filter((row) => row.outcomeVerdict === "CORRECT" || row.outcomeVerdict === "INCORRECT")
        .map((row) => ({
          organizationId: row.organizationId,
          forecastRecordId: row.forecastRecordId,
          resolvedAt: row.resolvedAt!.toISOString(),
          verdict: row.outcomeVerdict as OutcomeResolutionRow["verdict"],
        }));

      if (query.limit !== undefined) {
        return mapped.slice(0, query.limit);
      }
      return mapped;
    },
  };
}
