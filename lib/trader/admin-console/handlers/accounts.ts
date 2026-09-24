import { readOverviewSnapshot } from "@/lib/trader/admin-console/repositories/overview.postgres";

import {
  adminSuccess,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import { adminEnvelope } from "@/lib/trader/admin-console/data-state";
import { HANDLER_TABLES } from "@/lib/trader/admin-console/handler-tables";
import { openAdminConsole } from "@/lib/trader/admin-console/handlers/guard";
import {
  adminScopeFromQuery,
  parseAdminConsoleQuery,
  periodBounds,
} from "@/lib/trader/admin-console/scope";

export async function handleAdminConsoleAccountsGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const parsed = parseAdminConsoleQuery(new URL(request.url));
  if (!parsed.ok) return parsed.result;
  const opened = await openAdminConsole(request, deps, {
    requiredTables: HANDLER_TABLES.accounts,
  });
  if (!opened.ok) return opened.result;
  try {
    const now = new Date();
    const snapshot = await readOverviewSnapshot(opened.runtime.db, {
      ...periodBounds(parsed.query, now),
      scope: adminScopeFromQuery(parsed.query),
      currency: parsed.query.currency,
      mode: parsed.query.mode,
      nowMs: now.getTime(),
    });
    return adminSuccess(
      adminEnvelope({
        data: {
          items: snapshot.value.accounts,
          aggregate: snapshot.value.overview,
        },
        financeRevision: snapshot.value.overview.financeRevision,
        missingSources: snapshot.value.capped ? ["ACCOUNT_CAP"] : [],
        cursor: snapshot.cursor,
        coverage: {
          included: snapshot.value.overview.included,
          total: snapshot.value.overview.total,
          excluded: snapshot.value.accounts
            .filter((account) => !account.included)
            .map((account) => ({ id: account.id, reason: account.reason ?? "EXCLUDED" })),
        },
        scope: adminScopeFromQuery(parsed.query),
        mode: snapshot.value.mode,
      }),
      "postgres",
    );
  } finally {
    await deps.disposeRuntimeDb(opened.runtime);
  }
}
