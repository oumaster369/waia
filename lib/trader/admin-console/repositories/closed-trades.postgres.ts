import { legScopeFilter } from "@/lib/trader/admin-console/sql/leg-scope-filter";
import { sql } from "drizzle-orm";

import { adminSuccess, type AdminRouteHandlerResult } from "@/lib/trader/admin-route-shared";
import { adminEnvelope } from "@/lib/trader/admin-console/data-state";
import { adminScopeFromQuery, periodBounds } from "@/lib/trader/admin-console/scope";

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

import type { AdminReadTx } from "@/lib/trader/admin-console/repositories/snapshot.postgres";
import type { AdminConsoleQuery } from "@/lib/trader/admin-console/scope";

export async function readConsoleClosedTrades(
  tx: AdminReadTx,
  query: AdminConsoleQuery,
): Promise<AdminRouteHandlerResult> {
  const organizationId = query.organization_id ?? null;
  const bounds = periodBounds(query, new Date());
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
      AND ${legScopeFilter(query, "trade", "trader_trades")}
      AND closed_at IS NOT NULL
      AND closed_at >= ${bounds.start}::timestamptz
      AND closed_at < ${bounds.end}::timestamptz
      AND (${organizationId}::uuid IS NULL OR organization_id = ${organizationId}::uuid)
    ORDER BY closed_at DESC, id DESC
    LIMIT ${query.limit}
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
      scope: adminScopeFromQuery(query),
      mode: query.mode,
    }),
    "postgres",
  );
}
