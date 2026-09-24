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

export async function handleAdminConsolePaymentsGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const parsed = parseAdminConsoleQuery(new URL(request.url));
  if (!parsed.ok) return parsed.result;
  const opened = await openAdminConsole(request, deps, {
    requiredTables: HANDLER_TABLES.payments,
  });
  if (!opened.ok) return opened.result;
  try {
    return await withAdminRouteSnapshot(opened.runtime.db, async (tx) => {
      const rows = rowsOf(
        await tx.execute(sql`
        SELECT id::text AS id,
               organization_id::text AS organization_id,
               event_type,
               subject_invoice_id,
               settlement_asset,
               settlement_amount,
               settlement_tx_hash,
               created_at
        FROM payment_events
        WHERE subject_module = 'trader'
          AND ${organizationFilter(parsed.query, "payment_events")}
          AND (${parsed.query.exchange_account_id ?? null}::text IS NULL OR EXISTS (
            SELECT 1 FROM trader_invoices scoped_invoice
            WHERE scoped_invoice.id::text = payment_events.subject_invoice_id
              AND scoped_invoice.organization_id = payment_events.organization_id
              AND scoped_invoice.exchange_account_id = ${parsed.query.exchange_account_id ?? null}
          ))
        ORDER BY created_at DESC, id
        LIMIT ${parsed.query.limit}
      `),
      );
      return adminSuccess(
        adminEnvelope({
          data: {
            items: rows.map((row) => ({
              id: String(row.id),
              organizationId: String(row.organization_id),
              eventType: String(row.event_type),
              subjectInvoiceId:
                row.subject_invoice_id == null ? null : String(row.subject_invoice_id),
              asset: row.settlement_asset == null ? null : String(row.settlement_asset),
              amount: row.settlement_amount == null ? null : String(row.settlement_amount),
              txHash: row.settlement_tx_hash == null ? null : String(row.settlement_tx_hash),
              createdAt: iso(row.created_at),
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
