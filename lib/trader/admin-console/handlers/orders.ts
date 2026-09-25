import { readConsoleOrders } from "@/lib/trader/admin-console/repositories/orders.postgres";
import { withAdminRouteSnapshot } from "@/lib/trader/admin-console/repositories/snapshot.postgres";
import {
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import { HANDLER_TABLES } from "@/lib/trader/admin-console/handler-tables";
import { openAdminConsole } from "@/lib/trader/admin-console/handlers/guard";
import { parseAdminConsoleQuery } from "@/lib/trader/admin-console/scope";
import { decodePageCursor } from "@/lib/trader/admin-console/cursor";

export async function handleAdminConsoleOrdersGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const url = new URL(request.url);
  const parsed = parseAdminConsoleQuery(url);
  if (!parsed.ok) return parsed.result;
  const cursor = parsed.query.cursor ? decodePageCursor(parsed.query.cursor) : null;
  if (parsed.query.cursor && !cursor) {
    return {
      status: 400,
      outcome: "client_error",
      body: { error: { code: "BAD_REQUEST", message: "cursor is invalid." } },
    };
  }
  const opened = await openAdminConsole(request, deps, {
    requiredTables: HANDLER_TABLES.orders,
  });
  if (!opened.ok) return opened.result;
  try {
    return await withAdminRouteSnapshot(opened.runtime.db, async (tx) => {
      return readConsoleOrders(tx, parsed.query);
    });
  } finally {
    await deps.disposeRuntimeDb(opened.runtime);
  }
}
