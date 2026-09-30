import {
  adminSuccess,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import { adminEnvelope } from "@/lib/trader/admin-console/data-state";
import { openAdminConsole } from "@/lib/trader/admin-console/handlers/guard";
import {
  adminScopeFromQuery,
  parseAdminConsoleQuery,
  periodBounds,
} from "@/lib/trader/admin-console/scope";
import { listDiscoveryLoopRuns } from "@/lib/trader/discovery/discovery-loop-repository-postgres";

const REQUIRED_TABLES = [
  "trader_discovery_loop_run",
  "trader_discovery_loop_trial",
  "trader_discovery_loop_verdict",
] as const;

/** Read-only discovery runs, trials, and verdicts. No orders and no live enablement. */
export async function handleAdminDiscoveryLoopGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const parsed = parseAdminConsoleQuery(new URL(request.url));
  if (!parsed.ok) return parsed.result;
  const opened = await openAdminConsole(request, deps, {
    requiredTables: REQUIRED_TABLES,
  });
  if (!opened.ok) return opened.result;
  try {
    const period = periodBounds(parsed.query, new Date());
    const items = await listDiscoveryLoopRuns(opened.runtime.db, {
      organizationId: parsed.query.organization_id,
      start: new Date(period.start),
      end: new Date(period.end),
      limit: parsed.query.limit,
    });
    return adminSuccess(
      adminEnvelope({
        scope: adminScopeFromQuery(parsed.query),
        mode: parsed.query.mode,
        data: {
          total: items.length,
          items,
        },
      }),
      "postgres",
    );
  } finally {
    await deps.disposeRuntimeDb(opened.runtime);
  }
}
