import { organizationFilter } from "@/lib/trader/admin-console/sql/read-scope";
import { withAdminRouteSnapshot } from "@/lib/trader/admin-console/repositories/snapshot.postgres";
import { sql } from "drizzle-orm";

import {
  adminSuccess,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import { adminEnvelope } from "@/lib/trader/admin-console/data-state";
import { HANDLER_TABLES } from "@/lib/trader/admin-console/handler-tables";
import { openAdminConsole } from "@/lib/trader/admin-console/handlers/guard";
import { presentResearchRun } from "@/lib/trader/admin-console/research/research-runs";
import {
  adminScopeFromQuery,
  parseAdminConsoleQuery,
  periodBounds,
} from "@/lib/trader/admin-console/scope";

function rowsOf(result: unknown): Record<string, unknown>[] {
  return Array.isArray(result) ? (result as Record<string, unknown>[]) : [];
}

function iso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "string" || value.length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export async function handleAdminConsoleResearchRunsGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const parsed = parseAdminConsoleQuery(new URL(request.url));
  if (!parsed.ok) return parsed.result;
  const opened = await openAdminConsole(request, deps, {
    requiredTables: HANDLER_TABLES.researchRuns,
  });
  if (!opened.ok) return opened.result;
  try {
    return await withAdminRouteSnapshot(opened.runtime.db, async (tx) => {
      if (
        parsed.query.exchange_account_id ||
        (parsed.query.mode !== "history" && parsed.query.mode !== "all")
      ) {
        return adminSuccess(
          adminEnvelope({
            scope: adminScopeFromQuery(parsed.query),
            mode: parsed.query.mode,
            data: {
              state: "not_applicable",
              items: [],
              reasons: [
                parsed.query.exchange_account_id
                  ? "RESEARCH_EXCHANGE_ACCOUNT_BINDING_NOT_PERSISTED"
                  : "RESEARCH_REQUIRES_HISTORY_MODE",
              ],
            },
          }),
          "postgres",
        );
      }
      const period = periodBounds(parsed.query, new Date());
      const rows = rowsOf(
        await tx.execute(sql`
        WITH latest AS (SELECT DISTINCT ON (organization_id, run_id)
               organization_id::text AS organization_id,
               run_id,
               phase,
               committed_cycles,
               qualified_total_cycles,
               observed_at,
               symbol,
               partition
        FROM trader_historical_simulation_run_lifecycle_event_v2
        WHERE ${organizationFilter(parsed.query)}
        ORDER BY organization_id, run_id, event_sequence DESC)
        SELECT *, count(*) OVER()::text AS total FROM latest
        WHERE observed_at >= ${period.start}::timestamptz AND observed_at <= ${period.end}::timestamptz
        ORDER BY observed_at DESC, organization_id, run_id
        LIMIT ${parsed.query.limit}
      `),
      );
      const nowMs = Date.now();
      return adminSuccess(
        adminEnvelope({
          data: {
            total: Number(rows[0]?.total ?? 0),
            items: rows.flatMap((row) => {
              const observedAt = iso(row.observed_at);
              if (!observedAt) return [];
              return [
                presentResearchRun({
                  organizationId: String(row.organization_id),
                  runId: String(row.run_id),
                  phase: String(row.phase),
                  committedCycles: Number(row.committed_cycles),
                  qualifiedTotalCycles: Number(row.qualified_total_cycles),
                  observedAt,
                  symbol: String(row.symbol),
                  partition: String(row.partition),
                  nowMs,
                }),
              ];
            }),
          },
          scope: adminScopeFromQuery(parsed.query),
          mode: parsed.query.mode,
        }),
        "postgres",
      );
    });
  } finally {
    await deps.disposeRuntimeDb(opened.runtime);
  }
}
