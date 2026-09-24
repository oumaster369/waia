import { withAdminRouteSnapshot } from "@/lib/trader/admin-console/repositories/snapshot.postgres";
import { sql } from "drizzle-orm";
import {
  INVOICE_SELECT,
  displayOf,
  readInvoiceList,
} from "@/lib/trader/admin-console/repositories/invoices.postgres";

import { MIN_FEE_THRESHOLD } from "@/lib/trader/billing/fee-computation.types";
import { parseInvoicePaymentGracePeriodMs } from "@/lib/trader/settlement/account-status-policy";
import {
  adminClientError,
  adminSuccess,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import { checkFeeChain } from "@/lib/trader/admin-console/billing/fee-chain-check";
import { adminEnvelope } from "@/lib/trader/admin-console/data-state";
import { HANDLER_TABLES } from "@/lib/trader/admin-console/handler-tables";
import { openAdminConsole } from "@/lib/trader/admin-console/handlers/guard";
import { adminScopeFromQuery, parseAdminConsoleQuery } from "@/lib/trader/admin-console/scope";
import {
  organizationFilter,
  exchangeAccountFilter,
} from "@/lib/trader/admin-console/sql/read-scope";

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

export async function handleAdminConsoleInvoicesGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const parsed = parseAdminConsoleQuery(new URL(request.url));
  if (!parsed.ok) return parsed.result;
  const opened = await openAdminConsole(request, deps, {
    requiredTables: HANDLER_TABLES.invoices,
  });
  if (!opened.ok) return opened.result;
  try {
    return await withAdminRouteSnapshot(opened.runtime.db, async (tx) => {
      const result = await readInvoiceList(tx, parsed.query);
      return adminSuccess(
        adminEnvelope({
          data: {
            ...result,
            partialPayment: "частичная оплата не поддерживается (DEE-ADR-A)",
          },
          financeRevision: result.financeRevision,
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

export async function handleAdminConsoleInvoiceDetailGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
  invoiceId: string,
): Promise<AdminRouteHandlerResult> {
  const parsed = parseAdminConsoleQuery(new URL(request.url));
  if (!parsed.ok) return parsed.result;
  if (!/^[0-9a-f-]{36}$/i.test(invoiceId)) {
    return adminClientError(400, "BAD_REQUEST", "invoice id is invalid.");
  }
  const opened = await openAdminConsole(request, deps, {
    requiredTables: HANDLER_TABLES.invoices,
  });
  if (!opened.ok) return opened.result;
  try {
    return await withAdminRouteSnapshot(opened.runtime.db, async (tx) => {
      const rows = rowsOf(
        await tx.execute(sql`
        SELECT ${INVOICE_SELECT}
        FROM trader_invoices i
        WHERE i.id = ${invoiceId}::uuid
          AND ${organizationFilter(parsed.query, "i")} AND ${exchangeAccountFilter(parsed.query, "i")}
      `),
      );
      const row = rows[0];
      if (!row) return adminClientError(404, "NOT_FOUND", "invoice was not found.");
      const ledger = rowsOf(
        await tx.execute(sql`
        SELECT previous_high_water_mark
        FROM trader_hwm_ledger
        WHERE organization_id = ${String(row.organization_id)}::uuid
          AND exchange_account_id = ${String(row.exchange_account_id)}
          AND (source_invoice_id = ${invoiceId}
           OR source_period_id = ${String(row.reporting_period_id)})
        ORDER BY effective_at DESC
        LIMIT 1
      `),
      );
      const previous = rowsOf(
        await tx.execute(sql`
      SELECT cumulative_realized_strategy_profit
      FROM trader_invoices
      WHERE organization_id = ${String(row.organization_id)}::uuid
        AND exchange_account_id = ${String(row.exchange_account_id)}
        AND period_end = ${iso(row.period_start)}::timestamptz
        AND id <> ${invoiceId}::uuid
      ORDER BY period_end DESC, created_at DESC LIMIT 1
    `),
      );
      const previousCumulative = previous[0]?.cumulative_realized_strategy_profit;
      const ledgerHwm = ledger[0]?.previous_high_water_mark;
      const previousHwm = String(row.previous_high_water_mark);
      const cumulative = String(row.cumulative_realized_strategy_profit);
      const periodProfit = String(row.period_realized_strategy_profit);
      const chain = checkFeeChain({
        previousCumulative: typeof previousCumulative === "string" ? previousCumulative : null,
        periodProfit,
        cumulative,
        previousHwm,
        newProfitAboveHwm: String(row.new_profit_above_hwm),
        feeRate: String(row.fee_rate),
        performanceFee: String(row.performance_fee),
        billable: flag(row.billable),
        minFeeThreshold: MIN_FEE_THRESHOLD,
        ledgerPreviousHwm: typeof ledgerHwm === "string" ? ledgerHwm : null,
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
          missingSources: chain.ok === null ? chain.reasons : [],
        }),
        "postgres",
      );
    });
  } finally {
    await deps.disposeRuntimeDb(opened.runtime);
  }
}
