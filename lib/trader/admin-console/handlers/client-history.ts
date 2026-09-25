import { sql } from "drizzle-orm";
import {
  adminClientError,
  adminSuccess,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import { openAdminConsole } from "@/lib/trader/admin-console/handlers/guard";
import { HANDLER_TABLES } from "@/lib/trader/admin-console/handler-tables";
import { withAdminRouteSnapshot } from "@/lib/trader/admin-console/repositories/snapshot.postgres";
import { adminEnvelope } from "@/lib/trader/admin-console/data-state";
import { adminScopeFromQuery, parseAdminConsoleQuery } from "@/lib/trader/admin-console/scope";
export async function handleAdminConsoleClientHistoryGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
  clientId: string,
): Promise<AdminRouteHandlerResult> {
  const parsed = parseAdminConsoleQuery(new URL(request.url));
  if (!parsed.ok) return parsed.result;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId))
    return adminClientError(400, "BAD_REQUEST", "client id is invalid.");
  const opened = await openAdminConsole(request, deps, {
    requiredTables: HANDLER_TABLES.clientHistory,
  });
  if (!opened.ok) return opened.result;
  try {
    return await withAdminRouteSnapshot(opened.runtime.db, async (tx) => {
      if (parsed.query.organization_id && parsed.query.organization_id !== clientId)
        return adminClientError(404, "NOT_FOUND", "client was not found.");
      const account = parsed.query.exchange_account_id ?? null;
      const found = [
        ...(await tx.execute(sql`SELECT o.id FROM organizations o WHERE o.id = ${clientId}::uuid
      AND (EXISTS(SELECT 1 FROM organization_entitlements e WHERE e.organization_id = o.id AND e.entitlement_key = 'trader' AND e.enabled)
        OR EXISTS(SELECT 1 FROM trader_invoices i WHERE i.organization_id = o.id)
        OR EXISTS(SELECT 1 FROM exchange_credentials c WHERE c.organization_id = o.id))
      AND (${account}::text IS NULL OR EXISTS(SELECT 1 FROM exchange_credentials c WHERE c.organization_id = o.id AND c.exchange_account_id = ${account})
        OR EXISTS(SELECT 1 FROM trader_invoices i WHERE i.organization_id = o.id AND i.exchange_account_id = ${account})) LIMIT 1`)),
      ];
      if (!found.length) return adminClientError(404, "NOT_FOUND", "client was not found.");
      const rows = [
        ...(await tx.execute(sql`WITH events AS (
      SELECT id::text || ':created' AS id, 'CREDENTIAL_CREATED' AS type, exchange_account_id, created_at AS at
        FROM exchange_credentials WHERE organization_id=${clientId}::uuid AND (${account}::text IS NULL OR exchange_account_id=${account})
      UNION ALL SELECT id::text || ':revoked', 'CREDENTIAL_REVOKED', exchange_account_id, revoked_at
        FROM exchange_credentials WHERE organization_id=${clientId}::uuid AND revoked_at IS NOT NULL AND (${account}::text IS NULL OR exchange_account_id=${account})
      UNION ALL SELECT id::text, event_type::text, exchange_account_id, created_at
        FROM trader_account_status_events WHERE organization_id=${clientId}::uuid AND (${account}::text IS NULL OR exchange_account_id=${account})
      UNION ALL SELECT id::text || ':invoice', 'INVOICE_' || status::text, exchange_account_id, created_at
        FROM trader_invoices WHERE organization_id=${clientId}::uuid AND (${account}::text IS NULL OR exchange_account_id=${account})
    ) SELECT id,type,exchange_account_id,at::text FROM events ORDER BY at DESC,id DESC LIMIT 201`)),
      ];
      return adminSuccess(
        adminEnvelope({
          data: {
            items: rows
              .slice(0, 200)
              .map((row) => ({
                id: String(row.id),
                type: String(row.type),
                exchangeAccountId: String(row.exchange_account_id),
                at: String(row.at),
              })),
            truncated: rows.length > 200,
          },
          scope: adminScopeFromQuery(parsed.query),
          mode: parsed.query.mode,
          missingSources: rows.length > 200 ? ["CLIENT_HISTORY_CAP"] : [],
        }),
        "postgres",
      );
    });
  } finally {
    await deps.disposeRuntimeDb(opened.runtime);
  }
}
