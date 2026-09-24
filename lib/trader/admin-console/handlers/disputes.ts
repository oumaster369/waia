import { organizationFilter } from "@/lib/trader/admin-console/sql/read-scope";
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
import { adminScopeFromQuery, parseAdminConsoleQuery } from "@/lib/trader/admin-console/scope";

function rowsOf(result: unknown): Record<string, unknown>[] {
  return Array.isArray(result) ? (result as Record<string, unknown>[]) : [];
}

function iso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "string" || value.length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export async function handleAdminConsoleDisputesGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const parsed = parseAdminConsoleQuery(new URL(request.url));
  if (!parsed.ok) return parsed.result;
  const opened = await openAdminConsole(request, deps, {
    requiredTables: HANDLER_TABLES.disputes,
  });
  if (!opened.ok) return opened.result;
  try {
    return await withAdminRouteSnapshot(opened.runtime.db, async (tx) => {
      const rows = rowsOf(
        await tx.execute(sql`
        SELECT id::text AS id,
               organization_id::text AS organization_id,
               invoice_id::text AS invoice_id,
               status,
               reason,
               opened_at,
               resolved_at
        FROM trader_invoice_disputes
        WHERE ${organizationFilter(parsed.query, "trader_invoice_disputes")}
          AND (${parsed.query.exchange_account_id ?? null}::text IS NULL OR EXISTS (
            SELECT 1 FROM trader_invoices scoped_invoice
            WHERE scoped_invoice.id = trader_invoice_disputes.invoice_id
              AND scoped_invoice.organization_id = trader_invoice_disputes.organization_id
              AND scoped_invoice.exchange_account_id = ${parsed.query.exchange_account_id ?? null}
          ))
        ORDER BY opened_at DESC, id
        LIMIT ${parsed.query.limit}
      `),
      );
      return adminSuccess(
        adminEnvelope({
          data: {
            items: rows.map((row) => ({
              id: String(row.id),
              organizationId: String(row.organization_id),
              invoiceId: String(row.invoice_id),
              status: String(row.status),
              reason: row.reason == null ? null : String(row.reason),
              openedAt: iso(row.opened_at),
              resolvedAt: iso(row.resolved_at),
            })),
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
