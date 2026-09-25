import { orderScopeFilter } from "@/lib/trader/admin-console/sql/order-scope-filter";
import { sql } from "drizzle-orm";

import { adminSuccess, type AdminRouteHandlerResult } from "@/lib/trader/admin-route-shared";
import { adminEnvelope } from "@/lib/trader/admin-console/data-state";
import { presentConsoleOrder } from "@/lib/trader/admin-console/read-models/order";
import { WORKING_ORDER_STATES } from "@/lib/trader/admin-console/read-models/order-trace";
import { decodePageCursor, encodePageCursor } from "@/lib/trader/admin-console/cursor";
import { adminScopeFromQuery, periodBounds } from "@/lib/trader/admin-console/scope";
import { orderVisibleInMode } from "@/lib/trader/admin-console/sql/order-mode-filter";

function rowsOf(result: unknown): Record<string, unknown>[] {
  return Array.isArray(result) ? (result as Record<string, unknown>[]) : [];
}

import type { AdminReadTx } from "@/lib/trader/admin-console/repositories/snapshot.postgres";
import type { AdminConsoleQuery } from "@/lib/trader/admin-console/scope";

export async function readConsoleOrders(
  tx: AdminReadTx,
  query: AdminConsoleQuery,
): Promise<AdminRouteHandlerResult> {
  const bounds = periodBounds(query, new Date());
  const tab = query.tab === "all" ? "all" : "working";
  const cursor = query.cursor ? decodePageCursor(query.cursor) : null;
  const limit = query.limit;
  const rows = rowsOf(
    await tx.execute(sql`
    SELECT id::text AS id, organization_id::text AS organization_id, execution_mode,
           historical_run_id, symbol, side, state, quantity, filled_quantity,
           client_order_id, exchange_order_id, created_at::text AS created_at
    FROM trader_orders
    WHERE ${orderVisibleInMode(query.mode, false)}
    AND ${orderScopeFilter(query, "trader_orders")}
        AND (${query.status ?? null}::text IS NULL OR state::text = ${query.status ?? null})
    AND (${tab} = 'working' OR (created_at >= ${bounds.start}::timestamptz AND created_at < ${bounds.end}::timestamptz))
    AND (
      ${tab} = 'all'
      OR state IN ('CREATED','RISK_APPROVED','SENT_TO_EXCHANGE','ACCEPTED','PARTIALLY_FILLED','CANCEL_REQUESTED','RECONCILIATION_REQUIRED')
    )
    AND (
      ${cursor ? cursor.t : null}::timestamptz IS NULL
      OR created_at < ${cursor ? cursor.t : null}::timestamptz
      OR (created_at = ${cursor ? cursor.t : null}::timestamptz AND id::text < ${cursor ? cursor.id : null})
    )
    ORDER BY created_at DESC, id::text DESC
    LIMIT ${limit + 1}
  `),
  );
  const page = rows.slice(0, limit).map(presentConsoleOrder);
  const last = page[page.length - 1];
  return adminSuccess(
    adminEnvelope({
      data: {
        items: page,
        total: null,
        nextCursor:
          rows.length > limit && last ? encodePageCursor({ t: last.createdAt, id: last.id }) : null,
        truncated: rows.length > limit,
        tab,
        workingStates: WORKING_ORDER_STATES,
      },
      scope: adminScopeFromQuery(query),
      mode: query.mode,
    }),
    "postgres",
  );
}
