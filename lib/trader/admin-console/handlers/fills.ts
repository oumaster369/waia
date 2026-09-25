import { readConsoleFills } from "@/lib/trader/admin-console/repositories/fills.postgres";
import { withAdminRouteSnapshot } from "@/lib/trader/admin-console/repositories/snapshot.postgres";
import {
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import { HANDLER_TABLES } from "@/lib/trader/admin-console/handler-tables";
import { openAdminConsole } from "@/lib/trader/admin-console/handlers/guard";
import { parseAdminConsoleQuery } from "@/lib/trader/admin-console/scope";

export async function handleAdminConsoleFillsGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const parsed = parseAdminConsoleQuery(new URL(request.url));
  if (!parsed.ok) return parsed.result;
  const opened = await openAdminConsole(request, deps, {
    requiredTables: HANDLER_TABLES.fills,
  });
  if (!opened.ok) return opened.result;
  try {
    return await withAdminRouteSnapshot(opened.runtime.db, async (tx) => {
      return readConsoleFills(tx, parsed.query);
    });
  } finally {
    await deps.disposeRuntimeDb(opened.runtime);
  }
}

export { presentFill } from "@/lib/trader/admin-console/repositories/fills.postgres";
