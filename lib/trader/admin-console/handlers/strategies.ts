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
import {
  presentStrategyWorkspace,
  type StrategyEvidence,
} from "@/lib/trader/admin-console/research/strategy-workspace";
import {
  adminScopeFromQuery,
  parseAdminConsoleQuery,
  periodBounds,
} from "@/lib/trader/admin-console/scope";
import { organizationFilter } from "@/lib/trader/admin-console/sql/read-scope";
import { legScopeFilter } from "@/lib/trader/admin-console/sql/leg-scope-filter";

export async function handleAdminConsoleStrategiesGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const parsed = parseAdminConsoleQuery(new URL(request.url));
  if (!parsed.ok) return parsed.result;
  const query = parsed.query;
  const opened = await openAdminConsole(request, deps, {
    requiredTables: HANDLER_TABLES.strategies,
  });
  if (!opened.ok) return opened.result;
  try {
    return await withAdminRouteSnapshot(opened.runtime.db, async (tx) => {
      const period = periodBounds(query, new Date());
      const account = query.exchange_account_id ?? null;
      // Organization-level governance is not an account deployment binding.
      const evidence = await tx.execute(sql`WITH latest_lifecycle AS (
        SELECT DISTINCT ON (organization_id, strategy_id, strategy_version) * FROM trader_strategy_lifecycle_event
        WHERE ${organizationFilter(query)} AND effective_at <= now()
        ORDER BY organization_id, strategy_id, strategy_version, seq DESC
      ), facts AS (
        SELECT organization_id::text, strategy_id, strategy_version, 'trade' AS kind, id::text, state::text, opened_at AS at
        FROM trader_trades WHERE ${organizationFilter(query)} AND ${legScopeFilter(query, "trade", "trader_trades")}
          AND opened_at <= ${period.end}::timestamptz AND (closed_at IS NULL OR closed_at >= ${period.start}::timestamptz)
        UNION ALL
        SELECT organization_id::text, strategy_id, strategy_version, 'promotion', id::text, state::text, effective_at
        FROM trader_strategy_promotion_records WHERE ${organizationFilter(query)} AND ${account}::text IS NULL
          AND ${query.mode}::text IN ('live', 'all')
        UNION ALL
        SELECT organization_id::text, strategy_id, strategy_version, 'candidate', id::text, status::text, updated_at
        FROM trader_strategy_candidates WHERE ${organizationFilter(query)} AND ${account}::text IS NULL
        UNION ALL
        SELECT organization_id::text, strategy_id, strategy_version, 'lifecycle', id::text, to_state, effective_at
        FROM latest_lifecycle WHERE ${account}::text IS NULL
        UNION ALL
        SELECT organization_id::text, strategy_id, strategy_version, 'test', id::text, status::text, COALESCE(completed_at, started_at, created_at)
        FROM trader_backtest_runs WHERE ${organizationFilter(query)} AND ${account}::text IS NULL
          AND split <> 'blind'
      ) SELECT *, count(*) OVER()::text AS total FROM facts ORDER BY at DESC NULLS LAST, id LIMIT 2001`);
      const rows = Array.isArray(evidence) ? (evidence as Record<string, unknown>[]) : [];
      const facts: StrategyEvidence[] = rows.slice(0, 2000).map((row) => ({
        organizationId: String(row.organization_id),
        strategyId: String(row.strategy_id),
        version: String(row.strategy_version),
        kind: String(row.kind) as StrategyEvidence["kind"],
        id: String(row.id),
        state: String(row.state),
        at: row.at instanceof Date ? row.at.toISOString() : row.at == null ? null : String(row.at),
      }));
      const items = presentStrategyWorkspace(facts, query.mode);
      return adminSuccess(
        adminEnvelope({
          data: {
            items,
            workingCount: rows.length > 2000 ? null : items.filter((row) => row.working).length,
            evidenceTruncated: rows.length > 2000,
            scopeReason: account ? "STRATEGY_ACCOUNT_DEPLOYMENT_NOT_PERSISTED" : null,
          },
          scope: adminScopeFromQuery(query),
          mode: query.mode,
          missingSources: rows.length > 2000 ? ["STRATEGY_EVIDENCE_TRUNCATED"] : [],
        }),
        "postgres",
      );
    });
  } finally {
    await deps.disposeRuntimeDb(opened.runtime);
  }
}
