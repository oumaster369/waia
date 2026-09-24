import { sql, type SQL } from "drizzle-orm";
import type { AdminConsoleQuery } from "@/lib/trader/admin-console/scope";
import { column } from "@/lib/trader/admin-console/sql/read-scope";
import { orderScopeFilter } from "@/lib/trader/admin-console/sql/order-scope-filter";
import { orderVisibleInMode } from "@/lib/trader/admin-console/sql/order-mode-filter";

/** Filter from saved legs before LIMIT. Do not label a mixed or unbound trade as a selected mode. */
export function legScopeFilter(
  query: AdminConsoleQuery,
  parent: "lot" | "trade",
  alias: string,
): SQL {
  const legId = parent === "lot" ? sql`scoped_leg.position_lot_id` : sql`scoped_leg.trade_id`;
  const match = sql`${orderVisibleInMode(query.mode, true)} AND ${orderScopeFilter(query, "o")}`;
  return sql`(
    (${query.mode}::text = 'all' AND ${query.exchange_account_id ?? null}::text IS NULL)
    OR (
      EXISTS (
        SELECT 1 FROM trader_trade_legs scoped_leg
        JOIN trader_orders o ON o.id = scoped_leg.order_id AND o.organization_id = scoped_leg.organization_id
        WHERE ${legId} = ${column(alias, "id")}
          AND scoped_leg.organization_id = ${column(alias, "organization_id")}
          AND ${match}
      )
      AND NOT EXISTS (
        SELECT 1 FROM trader_trade_legs scoped_leg
        LEFT JOIN trader_orders o ON o.id = scoped_leg.order_id AND o.organization_id = scoped_leg.organization_id
        WHERE ${legId} = ${column(alias, "id")}
          AND scoped_leg.organization_id = ${column(alias, "organization_id")}
          AND (o.id IS NULL OR NOT (${match}))
      )
    )
  )`;
}
