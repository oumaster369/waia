import { readConsoleClients } from "@/lib/trader/admin-console/repositories/clients.postgres";
import { withAdminRouteSnapshot } from "@/lib/trader/admin-console/repositories/snapshot.postgres";
import {
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
  adminClientError,
} from "@/lib/trader/admin-route-shared";
import { HANDLER_TABLES } from "@/lib/trader/admin-console/handler-tables";
import { openAdminConsole } from "@/lib/trader/admin-console/handlers/guard";
import { parseAdminConsoleQuery } from "@/lib/trader/admin-console/scope";
import { decodePageCursor } from "@/lib/trader/admin-console/cursor";

export async function handleAdminConsoleClientsGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
  clientId?: string,
): Promise<AdminRouteHandlerResult> {
  const parsed = parseAdminConsoleQuery(new URL(request.url));
  if (!parsed.ok) return parsed.result;
  const cursor = !clientId && parsed.query.cursor ? decodePageCursor(parsed.query.cursor) : null;
  if (!clientId && parsed.query.cursor && !cursor)
    return adminClientError(400, "BAD_REQUEST", "Cursor is invalid.");
  if (clientId && !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(clientId))
    return adminClientError(400, "BAD_REQUEST", "Client id is invalid.");
  if (clientId && parsed.query.organization_id && parsed.query.organization_id !== clientId)
    return adminClientError(404, "NOT_FOUND", "Client not found in scope.");
  const opened = await openAdminConsole(request, deps, {
    requiredTables: HANDLER_TABLES.clients,
  });
  if (!opened.ok) return opened.result;
  try {
    return await withAdminRouteSnapshot(opened.runtime.db, async (tx) => {
      return readConsoleClients(tx, parsed.query, clientId);
    });
  } finally {
    await deps.disposeRuntimeDb(opened.runtime);
  }
}
