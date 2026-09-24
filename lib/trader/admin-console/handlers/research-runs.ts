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
import { adminScopeFromQuery, parseAdminConsoleQuery } from "@/lib/trader/admin-console/scope";

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
    const rows = rowsOf(
      await opened.runtime.db.execute(sql`
        SELECT DISTINCT ON (organization_id, run_id)
               organization_id::text AS organization_id,
               run_id,
               phase,
               committed_cycles,
               qualified_total_cycles,
               observed_at,
               symbol,
               partition
        FROM trader_historical_simulation_run_lifecycle_event_v2
        ORDER BY organization_id, run_id, event_sequence DESC
        LIMIT ${parsed.query.limit}
      `),
    );
    const nowMs = Date.now();
    return adminSuccess(
      adminEnvelope({
        data: {
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
  } finally {
    await deps.disposeRuntimeDb(opened.runtime);
  }
}
