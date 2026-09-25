import { sql } from "drizzle-orm";
import {
  adminSuccess,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import { adminEnvelope } from "@/lib/trader/admin-console/data-state";
import { HANDLER_TABLES } from "@/lib/trader/admin-console/handler-tables";
import { openAdminConsole } from "@/lib/trader/admin-console/handlers/guard";
import { withAdminRouteSnapshot } from "@/lib/trader/admin-console/repositories/snapshot.postgres";
import { readAdminRelease } from "@/lib/trader/admin-console/release";

/** Global navigation catalogue contains identities only, never a second financial projection. */
export async function handleAdminConsoleContextGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const opened = await openAdminConsole(request, deps, { requiredTables: HANDLER_TABLES.context });
  if (!opened.ok) return opened.result;
  try {
    return await withAdminRouteSnapshot(opened.runtime.db, async (tx) => {
      const clients = await tx.execute(sql`
        SELECT o.id::text AS id, o.name, count(*) OVER ()::int AS total
        FROM organizations o
        WHERE EXISTS (SELECT 1 FROM organization_entitlements e WHERE e.organization_id = o.id AND e.entitlement_key = 'trader' AND e.enabled)
          OR EXISTS (SELECT 1 FROM exchange_credentials c WHERE c.organization_id = o.id)
          OR EXISTS (SELECT 1 FROM trader_invoices i WHERE i.organization_id = o.id)
        ORDER BY o.name, o.id LIMIT 1000
      `);
      const accounts = await tx.execute(sql`
        SELECT DISTINCT c.organization_id::text AS organization_id, c.exchange_account_id, c.venue
        FROM exchange_credentials c
        WHERE c.exchange_account_id IS NOT NULL
        ORDER BY c.organization_id::text, c.venue, c.exchange_account_id LIMIT 1001
      `);
      return adminSuccess(
        adminEnvelope({
          scope: { kind: "fleet" },
          data: {
            clients: [...clients].map((row) => ({
              id: String(row.id),
              name: String(row.name ?? ""),
            })),
            clientsTotal: clients.length ? Number(clients[0].total) : 0,
            accounts: [...accounts].slice(0, 1000).map((row) => ({
              organizationId: String(row.organization_id),
              exchangeAccountId: String(row.exchange_account_id),
              venue: String(row.venue),
            })),
            accountsTruncated: accounts.length > 1000,
            release: readAdminRelease(),
          },
        }),
        "postgres",
      );
    });
  } finally {
    await deps.disposeRuntimeDb(opened.runtime);
  }
}
