import { sql } from "drizzle-orm";

import {
  adminSuccess,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import { adminEnvelope } from "@/lib/trader/admin-console/data-state";
import { openAdminConsole } from "@/lib/trader/admin-console/handlers/guard";
import { orderMode } from "@/lib/trader/admin-console/modes/order-mode";
import { adminScopeFromQuery, parseAdminConsoleQuery } from "@/lib/trader/admin-console/scope";
import { orderVisibleInMode } from "@/lib/trader/admin-console/sql/order-mode-filter";

function rowsOf(result: unknown): Record<string, unknown>[] {
  return Array.isArray(result) ? (result as Record<string, unknown>[]) : [];
}

function iso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "string" || value.length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function presentFill(row: {
  id: string;
  organizationId: string;
  orderId: string;
  symbol: string;
  price: string;
  quantity: string;
  fee: string;
  feeAsset: string;
  executedAt: string | null;
  historicalRunId: string | null;
  executionMode: string;
}) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    orderId: row.orderId,
    symbol: row.symbol,
    price: row.price,
    quantity: row.quantity,
    fee: row.fee,
    feeAsset: row.feeAsset,
    executedAt: row.executedAt,
    mode: orderMode({
      historicalRunId: row.historicalRunId,
      executionMode: row.executionMode,
    }),
  };
}

export async function handleAdminConsoleFillsGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const parsed = parseAdminConsoleQuery(new URL(request.url));
  if (!parsed.ok) return parsed.result;
  const opened = await openAdminConsole(request, deps);
  if (!opened.ok) return opened.result;
  const organizationId = parsed.query.organization_id ?? null;
  try {
    const rows = rowsOf(
      await opened.runtime.db.execute(sql`
        SELECT f.id::text AS id,
               f.organization_id::text AS organization_id,
               f.order_id::text AS order_id,
               o.symbol,
               f.price,
               f.quantity,
               f.fee,
               f.fee_asset,
               f.executed_at,
               o.historical_run_id,
               o.execution_mode
        FROM trader_fills f
        JOIN trader_orders o
          ON o.id = f.order_id
         AND o.organization_id = f.organization_id
        WHERE (${organizationId}::uuid IS NULL OR f.organization_id = ${organizationId}::uuid)
          AND ${orderVisibleInMode(parsed.query.mode, true)}
        ORDER BY f.executed_at DESC, f.id DESC
        LIMIT ${parsed.query.limit}
      `),
    );
    return adminSuccess(
      adminEnvelope({
        data: {
          items: rows.map((row) =>
            presentFill({
              id: String(row.id),
              organizationId: String(row.organization_id),
              orderId: String(row.order_id),
              symbol: String(row.symbol),
              price: String(row.price),
              quantity: String(row.quantity),
              fee: String(row.fee),
              feeAsset: String(row.fee_asset),
              executedAt: iso(row.executed_at),
              historicalRunId: row.historical_run_id ? String(row.historical_run_id) : null,
              executionMode: String(row.execution_mode),
            }),
          ),
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
