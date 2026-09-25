import { organizationFilter } from "@/lib/trader/admin-console/sql/read-scope";
import { sql } from "drizzle-orm";

import { adminSuccess, type AdminRouteHandlerResult } from "@/lib/trader/admin-route-shared";
import { adminEnvelope } from "@/lib/trader/admin-console/data-state";
import { adminScopeFromQuery, periodBounds } from "@/lib/trader/admin-console/scope";

function rowsOf(result: unknown): Record<string, unknown>[] {
  return Array.isArray(result) ? (result as Record<string, unknown>[]) : [];
}

function iso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "string" || value.length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

import type { AdminReadTx } from "@/lib/trader/admin-console/repositories/snapshot.postgres";
import type { AdminConsoleQuery } from "@/lib/trader/admin-console/scope";

export async function readConsolePayments(
  tx: AdminReadTx,
  query: AdminConsoleQuery,
): Promise<AdminRouteHandlerResult> {
  const bounds = periodBounds(query, new Date());
  const rows = rowsOf(
    await tx.execute(sql`
    SELECT e.id::text AS id, e.organization_id::text AS organization_id,
      e.event_type, e.subject_invoice_id, e.settlement_asset, e.settlement_amount, e.settlement_tx_hash,
      e.settlement_network, e.confirmations_required, e.confirmations_observed, e.confirmed_at,
      e.created_at, s.outcome::text AS settlement_outcome, a.applied_amount, a.created_at AS applied_at
    FROM payment_events e
    LEFT JOIN trader_settlements s ON s.payment_id=e.payment_id AND s.organization_id=e.organization_id
    LEFT JOIN trader_settlement_applications a ON a.settlement_id=s.id AND a.organization_id=e.organization_id AND a.invoice_id::text=e.subject_invoice_id
    WHERE e.subject_module = 'trader'
      AND e.created_at >= ${bounds.start}::timestamptz AND e.created_at < ${bounds.end}::timestamptz
      AND ${organizationFilter(query, "e")}
      AND (${query.exchange_account_id ?? null}::text IS NULL OR EXISTS (
        SELECT 1 FROM trader_invoices scoped_invoice
        WHERE scoped_invoice.id::text = e.subject_invoice_id
          AND scoped_invoice.organization_id = e.organization_id
          AND scoped_invoice.exchange_account_id = ${query.exchange_account_id ?? null}
      ))
    ORDER BY e.created_at DESC, e.id
    LIMIT ${query.limit}
  `),
  );
  return adminSuccess(
    adminEnvelope({
      data: {
        items: rows.map((row) => ({
          id: String(row.id),
          organizationId: String(row.organization_id),
          eventType: String(row.event_type),
          subjectInvoiceId: row.subject_invoice_id == null ? null : String(row.subject_invoice_id),
          asset: row.settlement_asset == null ? null : String(row.settlement_asset),
          amount: row.settlement_amount == null ? null : String(row.settlement_amount),
          txHash: row.settlement_tx_hash == null ? null : String(row.settlement_tx_hash),
          createdAt: iso(row.created_at),
          network: row.settlement_network == null ? null : String(row.settlement_network),
          confirmationsRequired: row.confirmations_required ?? null,
          confirmationsObserved: row.confirmations_observed ?? null,
          confirmedAt: iso(row.confirmed_at),
          settlementOutcome: row.settlement_outcome == null ? null : String(row.settlement_outcome),
          appliedAmount: row.applied_amount == null ? null : String(row.applied_amount),
          appliedAt: iso(row.applied_at),
        })),
      },
      scope: adminScopeFromQuery(query),
      mode: query.mode,
    }),
    "postgres",
  );
}
