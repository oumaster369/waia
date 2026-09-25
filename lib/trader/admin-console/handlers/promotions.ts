import { readConsolePromotionState } from "@/lib/trader/admin-console/repositories/promotion-state.postgres";
import {
  adminClientError,
  adminSuccess,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import { HANDLER_TABLES } from "@/lib/trader/admin-console/handler-tables";
import { openAdminConsole } from "./guard";
import { withAdminRouteSnapshot } from "../repositories/snapshot.postgres";
import { adminScopeFromQuery, parseAdminConsoleQuery } from "../scope";
import { adminEnvelope } from "../data-state";
/** Metadata only. Qualification documents and holdout evidence never enter this read model. */
export async function handleAdminConsolePromotionsGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const url = new URL(request.url),
    parsed = parseAdminConsoleQuery(url);
  if (!parsed.ok) return parsed.result;
  const strategy = url.searchParams.get("strategy_id");
  if (!parsed.query.organization_id || !strategy || strategy.length > 200)
    return adminClientError(400, "BAD_REQUEST", "Organization and strategy required.");
  const opened = await openAdminConsole(request, deps, {
    requiredTables: HANDLER_TABLES.promotions,
  });
  if (!opened.ok) return opened.result;
  if (parsed.query.exchange_account_id) {
    await deps.disposeRuntimeDb(opened.runtime);
    return adminSuccess(
      adminEnvelope({
        data: { state: "not_applicable", reasons: ["STRATEGY_ACCOUNT_DEPLOYMENT_NOT_PERSISTED"] },
        scope: adminScopeFromQuery(parsed.query),
        mode: parsed.query.mode,
      }),
      "postgres",
    );
  }
  try {
    return await withAdminRouteSnapshot(opened.runtime.db, async (tx) => {
      const data = await readConsolePromotionState(tx, parsed.query.organization_id!, strategy);
      return adminSuccess(
        adminEnvelope({
          data,
          scope: adminScopeFromQuery(parsed.query),
          mode: parsed.query.mode,
        }),
        "postgres",
      );
    });
  } finally {
    await deps.disposeRuntimeDb(opened.runtime);
  }
}
