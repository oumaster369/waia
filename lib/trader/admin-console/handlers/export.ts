import { sql } from "drizzle-orm";

import {
  adminClientError,
  adminSuccess,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import { buildAdminCsv } from "@/lib/trader/admin-console/billing/export-csv";
import { adminRevision } from "@/lib/trader/admin-console/revision";
import { openAdminConsole } from "@/lib/trader/admin-console/handlers/guard";

function rowsOf(result: unknown): Record<string, unknown>[] {
  return Array.isArray(result) ? (result as Record<string, unknown>[]) : [];
}

export async function handleAdminConsoleExportGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const dataset = new URL(request.url).searchParams.get("dataset");
  if (dataset !== "invoices") {
    return adminClientError(400, "BAD_REQUEST", "Export dataset is invalid.");
  }
  const opened = await openAdminConsole(request, deps);
  if (!opened.ok) return opened.result;
  const started = Date.now();
  try {
    const rows = rowsOf(
      await opened.runtime.db.execute(sql`
        SELECT id::text AS id,
               status,
               currency,
               performance_fee
        FROM trader_invoices
        ORDER BY created_at DESC, id
        LIMIT 50000
      `),
    );
    const table = rows.map((row) => [
      String(row.id),
      String(row.status),
      String(row.currency),
      row.performance_fee == null ? "" : String(row.performance_fee),
    ]);
    const csv = buildAdminCsv({
      generatedAt: new Date().toISOString(),
      financeRevision: adminRevision(table),
      filters: "dataset=invoices",
      currency: "USDT",
      scope: "fleet",
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
