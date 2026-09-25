import { sql } from "drizzle-orm";
import { adminRevision } from "@/lib/trader/admin-console/revision";
import type { AdminReadTx } from "@/lib/trader/admin-console/repositories/snapshot.postgres";
import {
  adminScopeFromQuery,
  periodBounds,
  type AdminConsoleQuery,
} from "@/lib/trader/admin-console/scope";
import {
  organizationFilter,
  exchangeAccountFilter,
} from "@/lib/trader/admin-console/sql/read-scope";
import { parseInvoicePaymentGracePeriodMs } from "@/lib/trader/settlement/account-status-policy";
import {
  invoiceDisplayStatus,
  invoiceDueAt,
  type InvoiceDisplayInput,
} from "@/lib/trader/admin-console/billing/invoice-display-status";
function flag(value: unknown): boolean {
  return value === true || value === "t" || value === "true" || value === 1;
}
function iso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : null;
}
export function invoiceReadRevision(row: Record<string, unknown>): string {
  return adminRevision(JSON.parse(JSON.stringify(row)));
}
export function displayOf(row: Record<string, unknown>, now: string, graceMs: number) {
  const issuedAt = iso(row.issued_at);
  const dueAt = invoiceDueAt(issuedAt, graceMs);
  const status = String(row.status);
  const input: InvoiceDisplayInput = {
    state: status === "PAID" || status === "DRAFT" || status === "ISSUED" ? status : "DRAFT",
    approved: iso(row.issuance_approved_at) !== null,
    coolingOffUntil: iso(row.cooling_off_until),
    paymentDetected: flag(row.payment_detected),
    paymentApplied: flag(row.payment_applied),
    now,
    dueAt,
    paidAt: iso(row.paid_at),
    reconciliation: flag(row.reconciliation),
    disputeOpen: flag(row.dispute_open),
    corrected: flag(row.corrected),
  };
  return { display: invoiceDisplayStatus(input), dueAt };
}

export const INVOICE_SELECT = sql`
  i.id::text AS id,
  i.organization_id::text AS organization_id,
  i.exchange_account_id,
  i.reporting_period_id,
  i.period_start,
  i.period_end,
  i.status,
  i.currency,
  i.period_realized_strategy_profit,
  i.cumulative_realized_strategy_profit,
  i.previous_high_water_mark,
  i.new_profit_above_hwm,
  i.fee_rate,
  i.performance_fee,
  i.billable,
  i.issuance_approved_at,
  i.cooling_off_until,
  i.issued_at,
  i.paid_at,
  EXISTS (
    SELECT 1 FROM trader_invoice_disputes d
    WHERE d.invoice_id = i.id AND d.status = 'OPEN'
  ) AS dispute_open,
  EXISTS (
    SELECT 1 FROM trader_invoice_corrections c WHERE c.invoice_id = i.id
  ) AS corrected,
  (
    EXISTS (
      SELECT 1 FROM trader_settlement_applications a
      JOIN trader_settlements s ON s.id = a.settlement_id
      WHERE a.invoice_id = i.id AND s.outcome = 'EXCEPTION'
    )
    OR EXISTS (
      SELECT 1 FROM trader_settlement_applications a
      JOIN trader_settlement_reconciliation_cases r ON r.settlement_id = a.settlement_id
      WHERE a.invoice_id = i.id AND r.status NOT IN ('RESOLVED', 'CANCELLED')
    )
  ) AS reconciliation,
  EXISTS (
    SELECT 1 FROM payment_events e
    WHERE e.subject_module = 'trader'
      AND e.subject_invoice_id = i.id::text
      AND e.event_type = 'DETECTED'
  ) AS payment_detected,
  EXISTS (
    SELECT 1 FROM trader_settlement_applications a WHERE a.invoice_id = i.id
  ) AS payment_applied
`;

/** Saved invoice values only; HTTP, CSV and assistant share filters, summary and revision. */
export async function readInvoiceList(
  tx: AdminReadTx,
  query: AdminConsoleQuery,
  limit = query.limit,
) {
  const bounds = periodBounds(query, new Date());
  const filter = sql`${organizationFilter(query, "i")} AND ${exchangeAccountFilter(query, "i")}
    AND i.period_start < ${bounds.end}::timestamptz AND i.period_end >= ${bounds.start}::timestamptz`;
  const raw = await tx.execute(sql`SELECT ${INVOICE_SELECT} FROM trader_invoices i
    WHERE ${filter} ORDER BY i.created_at DESC, i.id LIMIT ${limit + 1}`);
  const totals = await tx.execute(sql`
    SELECT i.currency, count(*)::int AS total, sum(i.performance_fee::numeric)::text AS amount,
           md5(string_agg(concat_ws(':', i.id::text, i.record_content_digest, i.status::text,
             i.performance_fee, i.issuance_approved_at::text, i.cooling_off_until::text,
             i.issued_at::text, i.paid_at::text), '|' ORDER BY i.id)) AS digest
    FROM trader_invoices i WHERE ${filter} GROUP BY i.currency ORDER BY i.currency
  `);
  const aggregate = (totals as Record<string, unknown>[]).map((row) => ({
    currency: String(row.currency),
    count: Number(row.total),
    amount: row.amount == null ? null : String(row.amount),
    method: "saved_invoice",
    digest: String(row.digest),
  }));
  const now = new Date().toISOString();
  const graceMs = parseInvoicePaymentGracePeriodMs(process.env);
  const rows = raw as Record<string, unknown>[];
  return {
    items: rows.slice(0, limit).map((row) => ({
      id: String(row.id),
      revision: invoiceReadRevision(row),
      organizationId: String(row.organization_id),
      exchangeAccountId: String(row.exchange_account_id),
      status: String(row.status),
      performanceFee: String(row.performance_fee),
      currency: String(row.currency),
      ...displayOf(row, now, graceMs),
    })),
    aggregate,
    total: aggregate.reduce((sum, row) => sum + row.count, 0),
    truncated: rows.length > limit,
    financeRevision: adminRevision({ scope: adminScopeFromQuery(query), aggregate }),
  };
}
