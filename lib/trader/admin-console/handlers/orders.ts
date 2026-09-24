import { orderScopeFilter } from "@/lib/trader/admin-console/sql/order-scope-filter";
import { withAdminRouteSnapshot } from "@/lib/trader/admin-console/repositories/snapshot.postgres";
import { sql } from "drizzle-orm";

import {
  adminSuccess,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import { HANDLER_TABLES } from "@/lib/trader/admin-console/handler-tables";
import { openAdminConsole } from "@/lib/trader/admin-console/handlers/guard";
import { adminEnvelope } from "@/lib/trader/admin-console/data-state";
import { presentConsoleOrder } from "@/lib/trader/admin-console/read-models/order";
import { WORKING_ORDER_STATES } from "@/lib/trader/admin-console/read-models/order-trace";
import { decodePageCursor, encodePageCursor } from "@/lib/trader/admin-console/cursor";
import {
  adminScopeFromQuery,
  parseAdminConsoleQuery,
  periodBounds,
} from "@/lib/trader/admin-console/scope";
import { orderVisibleInMode } from "@/lib/trader/admin-console/sql/order-mode-filter";

function rowsOf(result: unknown): Record<string, unknown>[] {
  return Array.isArray(result) ? (result as Record<string, unknown>[]) : [];
}

export async function handleAdminConsoleOrdersGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const url = new URL(request.url);
  const parsed = parseAdminConsoleQuery(url);
  if (!parsed.ok) return parsed.result;
  const bounds = periodBounds(parsed.query, new Date());
  const tab = url.searchParams.get("tab") === "all" ? "all" : "working";
  const cursor = parsed.query.cursor ? decodePageCursor(parsed.query.cursor) : null;
  if (parsed.query.cursor && !cursor) {
    return {
      status: 400,
      outcome: "client_error",
      body: { error: { code: "BAD_REQUEST", message: "cursor is invalid." } },
    };
  }
  const opened = await openAdminConsole(request, deps, {
    requiredTables: HANDLER_TABLES.orders,
  });
  if (!opened.ok) return opened.result;
  try {
    return await withAdminRouteSnapshot(opened.runtime.db, async (tx) => {
      const limit = parsed.query.limit;
      const rows = rowsOf(
        await tx.execute(sql`
        SELECT id::text AS id, organization_id::text AS organization_id, execution_mode,
               historical_run_id, symbol, side, state, quantity, filled_quantity,
               client_order_id, exchange_order_id, created_at::text AS created_at
        FROM trader_orders
        WHERE ${orderVisibleInMode(parsed.query.mode, false)}
        AND ${orderScopeFilter(parsed.query, "trader_orders")}
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
              rows.length > limit && last
                ? encodePageCursor({ t: last.createdAt, id: last.id })
                : null,
            truncated: rows.length > limit,
            tab,
            workingStates: WORKING_ORDER_STATES,
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
