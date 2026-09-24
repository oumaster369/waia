import { sql } from "drizzle-orm";

import {
  adminSuccess,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import { presentClient } from "@/lib/trader/admin-console/billing/clients";
import { adminEnvelope } from "@/lib/trader/admin-console/data-state";
import { HANDLER_TABLES } from "@/lib/trader/admin-console/handler-tables";
import { openAdminConsole } from "@/lib/trader/admin-console/handlers/guard";
import { adminScopeFromQuery, parseAdminConsoleQuery } from "@/lib/trader/admin-console/scope";

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

export async function handleAdminConsoleClientsGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const parsed = parseAdminConsoleQuery(new URL(request.url));
  if (!parsed.ok) return parsed.result;
  const opened = await openAdminConsole(request, deps, {
    requiredTables: HANDLER_TABLES.clients,
  });
  if (!opened.ok) return opened.result;
  try {
    const organizationId = parsed.query.organization_id ?? null;
    const rows = rowsOf(
      await opened.runtime.db.execute(sql`
        SELECT o.id::text AS id,
               COALESCE(o.name, '') AS name,
               u.email AS owner_email,
               u.created_at AS registered_at,
               EXISTS (
                 SELECT 1 FROM organization_entitlements e
                 WHERE e.organization_id = o.id
                   AND e.entitlement_key = 'trader'
                   AND e.enabled
               ) AS entitlement_enabled,
               EXISTS (
                 SELECT 1 FROM trader_invoices i WHERE i.organization_id = o.id
               ) AS has_invoice,
               EXISTS (
                 SELECT 1 FROM exchange_credentials c WHERE c.organization_id = o.id
               ) AS has_credential,
               EXISTS (
                 SELECT 1 FROM trader_invoices i
                 WHERE i.organization_id = o.id AND i.status = 'ISSUED'
               ) AS has_debt,
               EXISTS (
                 SELECT 1 FROM trader_position_lots l
                 WHERE l.organization_id = o.id AND l.state = 'OPEN'
               ) AS has_open_lots,
               (
                 SELECT MIN(obs.recorded_at)
                 FROM trader_account_observations obs
                 WHERE obs.organization_id = o.id
               ) AS first_connected_at
        FROM organizations o
        JOIN users u ON u.id = o.owner_user_id
        WHERE (
          ${organizationId}::uuid IS NULL OR o.id = ${organizationId}::uuid
        )
        AND (
          EXISTS (
            SELECT 1 FROM organization_entitlements e
            WHERE e.organization_id = o.id AND e.entitlement_key = 'trader' AND e.enabled
          )
          OR EXISTS (SELECT 1 FROM trader_invoices i WHERE i.organization_id = o.id)
          OR EXISTS (SELECT 1 FROM exchange_credentials c WHERE c.organization_id = o.id)
          OR EXISTS (
            SELECT 1 FROM trader_invoices i
            WHERE i.organization_id = o.id AND i.status = 'ISSUED'
          )
          OR EXISTS (
            SELECT 1 FROM trader_position_lots l
            WHERE l.organization_id = o.id AND l.state = 'OPEN'
          )
        )
        ORDER BY o.created_at DESC, o.id
        LIMIT ${parsed.query.limit}
      `),
    );
    const items = rows.flatMap((row) => {
      const client = presentClient({
        id: String(row.id),
        name: String(row.name ?? ""),
        ownerEmail: String(row.owner_email ?? ""),
        registeredAt: iso(row.registered_at),
        firstConnectedAt: iso(row.first_connected_at),
        entitlementEnabled: flag(row.entitlement_enabled),
        hasInvoice: flag(row.has_invoice),
        hasCredential: flag(row.has_credential),
        hasDebt: flag(row.has_debt),
        hasOpenLots: flag(row.has_open_lots),
      });
      return client ? [client] : [];
    });
    return adminSuccess(
      adminEnvelope({
        data: { items },
        scope: adminScopeFromQuery(parsed.query),
        mode: parsed.query.mode,
      }),
      "postgres",
    );
  } finally {
    await deps.disposeRuntimeDb(opened.runtime);
  }
}
