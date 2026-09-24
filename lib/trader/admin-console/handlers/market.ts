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
import { presentMarket } from "@/lib/trader/admin-console/read-models/market";
export async function handleAdminConsoleMarketGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const opened = await openAdminConsole(request, deps, { requiredTables: HANDLER_TABLES.market });
  if (!opened.ok) return opened.result;
  try {
    return await withAdminRouteSnapshot(opened.runtime.db, async (tx) => {
      const rows = await tx.execute(
        sql`SELECT source, base, quote, last, source_ts, observed_at FROM trader_admin_market_quote_latest WHERE base IN ('BTC', 'ETH') ORDER BY observed_at DESC`,
      );
      const fear = await tx.execute(
        sql`SELECT value, source_ts, observed_at FROM trader_admin_fear_greed ORDER BY day DESC LIMIT 1`,
      );
      return adminSuccess(
        adminEnvelope({
          scope: { kind: "fleet" },
          data: presentMarket([...rows], fear[0], Date.now()),
        }),
        "postgres",
      );
    });
  } finally {
    await deps.disposeRuntimeDb(opened.runtime);
  }
}
