import { sql } from "drizzle-orm";
import {
  adminSuccess,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import { adminEnvelope } from "@/lib/trader/admin-console/data-state";
import { HANDLER_TABLES } from "@/lib/trader/admin-console/handler-tables";
import { openAdminConsole } from "@/lib/trader/admin-console/handlers/guard";
import { withAdminRouteSnapshot } from "@/lib/trader/admin-console/repositories/snapshot.postgres";
import {
  adminScopeFromQuery,
  parseAdminConsoleQuery,
  periodBounds,
} from "@/lib/trader/admin-console/scope";
import {
  cycleProjection,
  cycleModeScopeFilter,
} from "@/lib/trader/admin-console/sql/cycle-projection";

/** The saved historical run or execution chain proves mode; the profile name does not. */
export async function handleAdminConsoleCyclesGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const parsed = parseAdminConsoleQuery(new URL(request.url));
  if (!parsed.ok) return parsed.result;
  const opened = await openAdminConsole(request, deps, { requiredTables: HANDLER_TABLES.cycles });
  if (!opened.ok) return opened.result;
  try {
    return await withAdminRouteSnapshot(opened.runtime.db, async (tx) => {
      const bounds = periodBounds(parsed.query, new Date());
      const result = await tx.execute(sql`WITH classified AS (${cycleProjection(parsed.query)})
        SELECT id::text,organization_id::text,run_id,cycle_id,symbol,evaluated_at,terminal_reason_code,mode FROM classified
        WHERE ${cycleModeScopeFilter(parsed.query, "classified")}
          AND evaluated_at>=${bounds.start}::timestamptz AND evaluated_at<${bounds.end}::timestamptz
        ORDER BY evaluated_at DESC,id LIMIT ${parsed.query.limit + 1}`);
      const rows = [...result];
      return adminSuccess(
        adminEnvelope({
          scope: adminScopeFromQuery(parsed.query),
          mode: parsed.query.mode,
          data: {
            items: rows
              .slice(0, parsed.query.limit)
              .map((row) => ({
                id: String(row.id),
                organizationId: String(row.organization_id),
                runId: String(row.run_id),
                cycleId: String(row.cycle_id),
                symbol: String(row.symbol),
                at: new Date(String(row.evaluated_at)).toISOString(),
                reason: String(row.terminal_reason_code),
                mode: String(row.mode),
              })),
            truncated: rows.length > parsed.query.limit,
            modeRule: "persisted_run_or_execution_chain",
            reasons: ["CYCLE_MODE_UNBOUND_EXCLUDED"],
          },
        }),
        "postgres",
      );
    });
  } finally {
    await deps.disposeRuntimeDb(opened.runtime);
  }
}
