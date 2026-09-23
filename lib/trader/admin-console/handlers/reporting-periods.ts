import { sql } from "drizzle-orm";

import {
  adminSuccess,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import { adminEnvelope } from "@/lib/trader/admin-console/data-state";
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

export async function handleAdminConsoleReportingPeriodsGet(
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
        SELECT id::text AS id,
               organization_id::text AS organization_id,
               exchange_account_id,
               status,
               period_start,
               period_end
        FROM trader_reporting_periods
        WHERE ${organizationId}::uuid IS NULL OR organization_id = ${organizationId}::uuid
        ORDER BY period_start DESC, id
        LIMIT ${parsed.query.limit}
      `),
    );
    return adminSuccess(
      adminEnvelope({
        data: {
          bounds: "[start, end)",
          timezone: parsed.query.tz,
          items: rows.map((row) => ({
            id: String(row.id),
            organizationId: String(row.organization_id),
            exchangeAccountId: String(row.exchange_account_id),
            status: String(row.status),
            start: iso(row.period_start),
            end: iso(row.period_end),
          })),
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
