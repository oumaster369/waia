import { legScopeFilter } from "@/lib/trader/admin-console/sql/leg-scope-filter";
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
  adminScopeFromQuery,
  parseAdminConsoleQuery,
  periodBounds,
} from "@/lib/trader/admin-console/scope";

const CLOSED_TRADE_LABELS: Record<string, string> = {
  CLOSED: "Закрыта",
  FORCED_FLAT: "Принудительно закрыта",
};

function rowsOf(result: unknown): Record<string, unknown>[] {
  return Array.isArray(result) ? (result as Record<string, unknown>[]) : [];
}

function iso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "string" || value.length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function presentClosedTrade(row: {
  id: string;
  organizationId: string;
  symbol: string;
  strategyId: string;
  strategyVersion: string;
  state: string;
  realizedPnl: string;
  closedAt: string | null;
}) {
  return {
    ...row,
    label: CLOSED_TRADE_LABELS[row.state] ?? row.state,
  };
}

export async function handleAdminConsoleClosedTradesGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const parsed = parseAdminConsoleQuery(new URL(request.url));
  if (!parsed.ok) return parsed.result;
  const opened = await openAdminConsole(request, deps, {
    requiredTables: HANDLER_TABLES.closedTrades,
  });
  if (!opened.ok) return opened.result;
  const organizationId = parsed.query.organization_id ?? null;
  const bounds = periodBounds(parsed.query, new Date());
  try {
    return await withAdminRouteSnapshot(opened.runtime.db, async (tx) => {
      const rows = rowsOf(
        await tx.execute(sql`
        SELECT id::text AS id,
               organization_id::text AS organization_id,
               symbol,
               strategy_id,
               strategy_version,
               state,
               realized_pnl,
               closed_at
        FROM trader_trades
        WHERE state IN ('CLOSED', 'FORCED_FLAT')
          AND ${legScopeFilter(parsed.query, "trade", "trader_trades")}
          AND closed_at IS NOT NULL
          AND closed_at >= ${bounds.start}::timestamptz
          AND closed_at < ${bounds.end}::timestamptz
          AND (${organizationId}::uuid IS NULL OR organization_id = ${organizationId}::uuid)
        ORDER BY closed_at DESC, id DESC
        LIMIT ${parsed.query.limit}
      `),
      );
      return adminSuccess(
        adminEnvelope({
          data: {
            items: rows.map((row) =>
              presentClosedTrade({
                id: String(row.id),
                organizationId: String(row.organization_id),
                symbol: String(row.symbol),
                strategyId: String(row.strategy_id),
                strategyVersion: String(row.strategy_version),
                state: String(row.state),
                realizedPnl: String(row.realized_pnl),
                closedAt: iso(row.closed_at),
              }),
            ),
            period: bounds,
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
