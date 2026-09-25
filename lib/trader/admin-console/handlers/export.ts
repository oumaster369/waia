import {
  adminClientError,
  adminSuccess,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import { streamAdminCsv, EXPORT_ROW_LIMIT } from "@/lib/trader/admin-console/billing/export-csv";
import { ADMIN_EXPORT_DATASETS as datasets } from "@/lib/trader/admin-console/export-datasets";
import { openAdminConsole } from "@/lib/trader/admin-console/handlers/guard";
import {
  parseAdminConsoleQuery,
  adminScopeFromQuery,
  periodBounds,
} from "@/lib/trader/admin-console/scope";
import { readInvoiceList } from "@/lib/trader/admin-console/repositories/invoices.postgres";
import { readOverviewWithinSnapshot } from "@/lib/trader/admin-console/repositories/overview.postgres";
import { readConsoleClients } from "@/lib/trader/admin-console/repositories/clients.postgres";
import { readConsoleOrders } from "@/lib/trader/admin-console/repositories/orders.postgres";
import { readConsoleFills } from "@/lib/trader/admin-console/repositories/fills.postgres";
import { readConsolePayments } from "@/lib/trader/admin-console/repositories/payments.postgres";
import { readConsoleClosedTrades } from "@/lib/trader/admin-console/repositories/closed-trades.postgres";
import { readConsoleInvoiceDetail } from "@/lib/trader/admin-console/handlers/invoices";
import { withAdminExportSnapshot } from "@/lib/trader/admin-console/repositories/export-snapshot.postgres";
import { adminEnvelope } from "@/lib/trader/admin-console/data-state";

type Dataset = keyof typeof datasets;
const cell = (value: unknown): string =>
  value === null || value === undefined
    ? ""
    : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);

export async function handleAdminConsoleExportGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
  invoiceId?: string,
): Promise<AdminRouteHandlerResult> {
  const url = new URL(request.url);
  const parsed = parseAdminConsoleQuery(url);
  if (!parsed.ok) return parsed.result;
  const dataset = invoiceId ? "invoices" : url.searchParams.get("dataset");
  if (!dataset || !Object.hasOwn(datasets, dataset))
    return adminClientError(400, "BAD_REQUEST", "Export dataset is invalid.");
  const config = datasets[dataset as Dataset];
  const format = invoiceId ? (url.searchParams.get("format") ?? "json") : "csv";
  if (invoiceId && !/^[0-9a-f-]{36}$/i.test(invoiceId))
    return adminClientError(400, "BAD_REQUEST", "Invoice id is invalid.");
  if (format !== "csv" && format !== "json")
    return adminClientError(
      400,
      "EXPORT_FORMAT_UNAVAILABLE",
      "Only saved JSON and CSV are available; PDF is unavailable.",
    );
  const opened = await openAdminConsole(request, deps, { requiredTables: config.tables });
  if (!opened.ok) return opened.result;
  const started = Date.now();
  const query = { ...parsed.query, limit: EXPORT_ROW_LIMIT + 1, cursor: undefined };
  try {
    const snapshot = await withAdminExportSnapshot(
      opened.runtime,
      request.signal,
      async (tx, cursor) => {
        if (invoiceId) return readConsoleInvoiceDetail(tx, query, invoiceId);
        if (dataset === "invoices") {
          const result = await readInvoiceList(tx, query, EXPORT_ROW_LIMIT);
          if (result.truncated) throw new Error("EXPORT_LIMIT");
          return adminSuccess(
            adminEnvelope({
              data: result,
              scope: adminScopeFromQuery(query),
              financeRevision: result.financeRevision,
              cursor,
              mode: query.mode,
            }),
            "postgres",
          );
        }
        if (dataset === "accounts") {
          const now = new Date();
          const result = await readOverviewWithinSnapshot(tx, {
            ...periodBounds(query, now),
            scope: adminScopeFromQuery(query),
            currency: query.currency,
            mode: query.mode,
            nowMs: now.getTime(),
            currentPeriod: query.period !== "custom",
          });
          return adminSuccess(
            adminEnvelope({
              data: {
                items:
                  query.tab === "attention"
                    ? result.accounts.filter((a) => a.state !== "ok")
                    : result.accounts,
              },
              scope: adminScopeFromQuery(query),
              financeRevision: result.overview.financeRevision,
              cursor,
              mode: result.mode,
              coverage: {
                included: result.overview.included,
                total: result.overview.total,
                excluded: result.accounts
                  .filter((a) => !a.included)
                  .map((a) => ({ id: a.id, reason: a.reason ?? "EXCLUDED" })),
              },
              missingSources: result.capped ? ["ACCOUNT_CAP"] : [],
            }),
            "postgres",
          );
        }
        const readers = {
          clients: readConsoleClients,
          orders: readConsoleOrders,
          fills: readConsoleFills,
          payments: readConsolePayments,
          closed_trades: readConsoleClosedTrades,
        };
        const response = await readers[dataset as keyof typeof readers](tx, query);
        return { ...response, body: { ...(response.body as object), cursor } };
      },
    );
    if (snapshot.status !== 200) return snapshot;
    const envelope = snapshot.body as {
      generatedAt: string;
      revision: string;
      financeRevision?: string;
      scope: unknown;
      data: Record<string, unknown>;
    };
    if (format === "json")
      return {
        ...snapshot,
        binaryBody: new TextEncoder().encode(JSON.stringify(envelope, null, 2)),
        responseHeaders: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="invoice-${invoiceId}.json"`,
        },
      };
    const rows = invoiceId
      ? Object.entries(envelope.data).map(([key, value]) => [key, cell(value)])
      : (envelope.data.items as Record<string, unknown>[]).map((row) =>
          config.columns.map((key) => cell(row[key])),
        );
    if (envelope.data.truncated || rows.length > EXPORT_ROW_LIMIT) throw new Error("EXPORT_LIMIT");
    const csv = streamAdminCsv(
      {
        generatedAt: envelope.generatedAt,
        financeRevision: envelope.financeRevision ?? envelope.revision,
        filters: url.searchParams.toString(),
        currency:
          dataset === "invoices"
            ? "stored_invoice_currency"
            : dataset === "accounts"
              ? query.currency
              : "native_record_currency",
        scope: JSON.stringify(envelope.scope),
        headers: invoiceId ? ["field", "saved_value"] : config.columns,
        rows,
        elapsedMs: Date.now() - started,
      },
      request.signal,
    );
    if (request.signal.aborted) throw new Error("EXPORT_ABORTED");
    return {
      ...adminSuccess({}, "postgres"),
      streamBody: csv,
      responseHeaders: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${invoiceId ? `invoice-${invoiceId}` : dataset}.csv"`,
      },
    };
  } catch (error) {
    if (error instanceof Error && error.message === "EXPORT_LIMIT")
      return adminClientError(
        413,
        "EXPORT_LIMIT",
        "Export is over the row or time limit; narrow the scope or period.",
      );
    if (error instanceof Error && error.message === "EXPORT_ABORTED")
      return adminClientError(499, "EXPORT_ABORTED", "Export cancelled.");
    if (error instanceof Error && error.message === "EXPORT_CANCEL_UNAVAILABLE")
      return adminClientError(
        503,
        "EXPORT_CANCEL_UNAVAILABLE",
        "Cancellable snapshot is unavailable.",
      );
    throw error;
  } finally {
    await deps.disposeRuntimeDb(opened.runtime);
  }
}
