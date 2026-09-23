import {
  adminSuccess,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import { openAdminConsole } from "@/lib/trader/admin-console/handlers/guard";

export async function handleAdminConsoleTimeGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const opened = await openAdminConsole(request, deps, { requireSchema: false });
  if (!opened.ok) return opened.result;
  try {
    return adminSuccess({ serverTime: new Date().toISOString() }, "postgres");
  } finally {
    await deps.disposeRuntimeDb(opened.runtime);
  }
}
