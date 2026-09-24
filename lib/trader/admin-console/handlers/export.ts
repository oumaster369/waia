import { withAdminReadSnapshot } from "@/lib/trader/admin-console/repositories/snapshot.postgres";
import { readInvoiceList } from "@/lib/trader/admin-console/repositories/invoices.postgres";
import { parseAdminConsoleQuery, adminScopeFromQuery } from "@/lib/trader/admin-console/scope";

import {
  adminClientError,
  adminSuccess,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import { buildAdminCsv } from "@/lib/trader/admin-console/billing/export-csv";
import { HANDLER_TABLES } from "@/lib/trader/admin-console/handler-tables";
import { openAdminConsole } from "@/lib/trader/admin-console/handlers/guard";

export async function handleAdminConsoleExportGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const url = new URL(request.url);
  const parsed = parseAdminConsoleQuery(url);
  if (!parsed.ok) return parsed.result;
  const dataset = url.searchParams.get("dataset");
  if (dataset !== "invoices") {
    return adminClientError(400, "BAD_REQUEST", "Export dataset is invalid.");
  }
  const opened = await openAdminConsole(request, deps, {
    requiredTables: HANDLER_TABLES.exportInvoices,
  });
  if (!opened.ok) return opened.result;
  const started = Date.now();
  try {
    const snapshot = await withAdminReadSnapshot(opened.runtime.db, (tx) =>
      readInvoiceList(tx, parsed.query, 50_000),
    );
    if (snapshot.value.truncated) throw new Error("EXPORT_LIMIT");
    const table = snapshot.value.items.map((row) => [
      row.id,
      row.status,
      row.currency,
      row.performanceFee,
    ]);
    const csv = buildAdminCsv({
      generatedAt: new Date().toISOString(),
      financeRevision: snapshot.value.financeRevision,
      filters: url.searchParams.toString(),
      currency: "stored_invoice_currency",
      scope: JSON.stringify(adminScopeFromQuery(parsed.query)),
      headers: ["id", "status", "currency", "performance_fee"],
      rows: table,
      elapsedMs: Date.now() - started,
    });
    return {
      ...adminSuccess({}, "postgres"),
      binaryBody: new TextEncoder().encode(csv),
      responseHeaders: {
        "Content-Type": "text/csv; charset=utf-8",
      },
    };
  } catch (error) {
    if (error instanceof Error && error.message === "EXPORT_LIMIT") {
      return adminClientError(413, "EXPORT_LIMIT", "Export is over the row or time limit.");
    }
    throw error;
  } finally {
    await deps.disposeRuntimeDb(opened.runtime);
  }
}
