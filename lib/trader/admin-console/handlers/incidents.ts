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

export async function handleAdminConsoleIncidentsGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const parsed = parseAdminConsoleQuery(new URL(request.url));
  if (!parsed.ok) return parsed.result;
  const opened = await openAdminConsole(request, deps);
  if (!opened.ok) return opened.result;
  try {
    const rows = rowsOf(
      await opened.runtime.db.execute(sql`
        SELECT id::text AS id,
               environment,
               service,
               fingerprint,
               title,
               severity,
               status,
               first_seen_at,
               last_seen_at,
               occurrences,
               affected_accounts,
               state_version
        FROM trader_admin_incident
        ORDER BY last_seen_at DESC, id
        LIMIT ${parsed.query.limit}
      `),
    );
    return adminSuccess(
      adminEnvelope({
        data: {
          items: rows.map((row) => ({
            id: String(row.id),
            environment: String(row.environment),
            service: String(row.service),
            fingerprint: String(row.fingerprint),
            title: String(row.title),
            severity: String(row.severity),
            status: String(row.status),
            firstSeenAt: iso(row.first_seen_at),
            lastSeenAt: iso(row.last_seen_at),
            occurrences: Number(row.occurrences),
            affectedAccounts: Number(row.affected_accounts),
            stateVersion: Number(row.state_version),
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
