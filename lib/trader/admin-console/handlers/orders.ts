import { sql } from "drizzle-orm";

import {
  adminSuccess,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import { openAdminConsole } from "@/lib/trader/admin-console/handlers/guard";
import { adminEnvelope } from "@/lib/trader/admin-console/data-state";
import { orderMode } from "@/lib/trader/admin-console/modes/order-mode";
import {
  ORDER_STATUS_LABELS,
  WORKING_ORDER_STATES,
} from "@/lib/trader/admin-console/read-models/order-trace";
import { decodePageCursor, encodePageCursor } from "@/lib/trader/admin-console/cursor";
import { adminScopeFromQuery, parseAdminConsoleQuery } from "@/lib/trader/admin-console/scope";
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
  const tab = url.searchParams.get("tab") === "all" ? "all" : "working";
  const cursor = parsed.query.cursor ? decodePageCursor(parsed.query.cursor) : null;
  if (parsed.query.cursor && !cursor) {
    return {
      status: 400,
      outcome: "client_error",
      body: { error: { code: "BAD_REQUEST", message: "cursor is invalid." } },
    };
  }
  const opened = await openAdminConsole(request, deps);
  if (!opened.ok) return opened.result;
  try {
    const limit = parsed.query.limit;
    const rows = rowsOf(
      await opened.runtime.db.execute(sql`
        SELECT id::text AS id, organization_id::text AS organization_id, execution_mode,
               historical_run_id, symbol, side, state, quantity, filled_quantity,
               client_order_id, exchange_order_id, created_at
        FROM trader_orders
        WHERE ${orderVisibleInMode(parsed.query.mode, false)}
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
    const page = rows.slice(0, limit).map((row) => {
      const state = String(row.state);
      return {
        id: String(row.id),
        organizationId: String(row.organization_id),
        symbol: String(row.symbol),
        side: String(row.side),
        state,
        label: ORDER_STATUS_LABELS[state as keyof typeof ORDER_STATUS_LABELS] ?? state,
        mode: orderMode({
          historicalRunId: row.historical_run_id ? String(row.historical_run_id) : null,
          executionMode: String(row.execution_mode),
        }),
        quantity: String(row.quantity),
        filledQuantity: String(row.filled_quantity),
        clientOrderId: String(row.client_order_id),
        exchangeOrderId: row.exchange_order_id ? String(row.exchange_order_id) : null,
        createdAt:
          row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      };
    });
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
  } finally {
    await deps.disposeRuntimeDb(opened.runtime);
  }
}
