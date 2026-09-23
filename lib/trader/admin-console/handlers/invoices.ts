import { sql } from "drizzle-orm";

import { MIN_FEE_THRESHOLD } from "@/lib/trader/billing/fee-computation.types";
import { parseInvoicePaymentGracePeriodMs } from "@/lib/trader/settlement/account-status-policy";
import {
  adminClientError,
  adminSuccess,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import { checkFeeChain } from "@/lib/trader/admin-console/billing/fee-chain-check";
import {
  invoiceDisplayStatus,
  invoiceDueAt,
  type InvoiceDisplayInput,
} from "@/lib/trader/admin-console/billing/invoice-display-status";
import { adminEnvelope } from "@/lib/trader/admin-console/data-state";
import { openAdminConsole } from "@/lib/trader/admin-console/handlers/guard";
import { adminScopeFromQuery, parseAdminConsoleQuery } from "@/lib/trader/admin-console/scope";
import { subtractDecimal } from "@/lib/trader/risk/numeric";

function rowsOf(result: unknown): Record<string, unknown>[] {
  return Array.isArray(result) ? (result as Record<string, unknown>[]) : [];
}

function flag(value: unknown): boolean {
  return value === true || value === "t" || value === "true" || value === 1;
}

function iso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "string" || value.length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function displayOf(row: Record<string, unknown>, now: string, graceMs: number) {
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

const INVOICE_SELECT = sql`
  i.id::text AS id,
  i.organization_id::text AS organization_id,
  i.exchange_account_id,
  i.reporting_period_id,
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

export async function handleAdminConsoleInvoicesGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const parsed = parseAdminConsoleQuery(new URL(request.url));
  if (!parsed.ok) return parsed.result;
  const opened = await openAdminConsole(request, deps);
  if (!opened.ok) return opened.result;
  try {
    const organizationId = parsed.query.organization_id ?? null;
    const rows = rowsOf(
      await opened.runtime.db.execute(sql`
        SELECT ${INVOICE_SELECT}
        FROM trader_invoices i
        WHERE ${organizationId}::uuid IS NULL OR i.organization_id = ${organizationId}::uuid
        ORDER BY i.created_at DESC, i.id
        LIMIT ${parsed.query.limit}
      `),
    );
    const now = new Date().toISOString();
    const graceMs = parseInvoicePaymentGracePeriodMs(process.env);
    return adminSuccess(
      adminEnvelope({
        data: {
          items: rows.map((row) => ({
            id: String(row.id),
            organizationId: String(row.organization_id),
            exchangeAccountId: String(row.exchange_account_id),
            performanceFee: String(row.performance_fee),
            currency: String(row.currency),
            ...displayOf(row, now, graceMs),
          })),
          partialPayment: "частичная оплата не поддерживается (DEE-ADR-A)",
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

export async function handleAdminConsoleInvoiceDetailGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
  invoiceId: string,
): Promise<AdminRouteHandlerResult> {
  if (!/^[0-9a-f-]{36}$/i.test(invoiceId)) {
    return adminClientError(400, "BAD_REQUEST", "invoice id is invalid.");
  }
  const opened = await openAdminConsole(request, deps);
  if (!opened.ok) return opened.result;
  try {
    const rows = rowsOf(
      await opened.runtime.db.execute(sql`
        SELECT ${INVOICE_SELECT}
        FROM trader_invoices i
        WHERE i.id = ${invoiceId}::uuid
      `),
    );
    const row = rows[0];
    if (!row) return adminClientError(404, "NOT_FOUND", "invoice was not found.");
    const ledger = rowsOf(
      await opened.runtime.db.execute(sql`
        SELECT previous_high_water_mark
        FROM trader_hwm_ledger
        WHERE source_invoice_id = ${invoiceId}
           OR source_period_id = ${String(row.reporting_period_id)}
        ORDER BY effective_at DESC
        LIMIT 1
      `),
    );
    const ledgerHwm = ledger[0]?.previous_high_water_mark;
    const previousHwm = String(row.previous_high_water_mark);
    const cumulative = String(row.cumulative_realized_strategy_profit);
    const periodProfit = String(row.period_realized_strategy_profit);
    const chain = checkFeeChain({
      previousCumulative: subtractDecimal(cumulative, periodProfit),
      periodProfit,
      cumulative,
      previousHwm,
      newProfitAboveHwm: String(row.new_profit_above_hwm),
      feeRate: String(row.fee_rate),
      performanceFee: String(row.performance_fee),
      billable: flag(row.billable),
      minFeeThreshold: MIN_FEE_THRESHOLD,
      ledgerPreviousHwm: typeof ledgerHwm === "string" ? ledgerHwm : previousHwm,
    });
    const now = new Date().toISOString();
    const graceMs = parseInvoicePaymentGracePeriodMs(process.env);
    return adminSuccess(
      adminEnvelope({
        data: {
          stored: {
            periodProfit,
            cumulative,
            previousHwm,
            newProfitAboveHwm: String(row.new_profit_above_hwm),
            feeRate: String(row.fee_rate),
            performanceFee: String(row.performance_fee),
            billable: flag(row.billable),
          },
          chain,
          ...displayOf(row, now, graceMs),
          tradesNote: "оперативная выборка, не база комиссии",
        },
        scope: { kind: "organization", organizationId: String(row.organization_id) },
        missingSources: [...(ledger[0] ? [] : ["HWM_LEDGER"]), "PREVIOUS_CUMULATIVE_DERIVED"],
      }),
      "postgres",
    );
  } finally {
    await deps.disposeRuntimeDb(opened.runtime);
  }
}
