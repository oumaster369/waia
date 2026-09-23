import {
  adminSuccess,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import { adminEnvelope } from "@/lib/trader/admin-console/data-state";
import { openAdminConsole } from "@/lib/trader/admin-console/handlers/guard";
import { ADMIN_REASON } from "@/lib/trader/admin-console/reason-codes";
import { readOverviewSnapshot } from "@/lib/trader/admin-console/repositories/overview.postgres";
import {
  adminScopeFromQuery,
  parseAdminConsoleQuery,
  periodBounds,
} from "@/lib/trader/admin-console/scope";

export async function handleAdminConsoleOverviewGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const parsed = parseAdminConsoleQuery(new URL(request.url));
  if (!parsed.ok) return parsed.result;
  const opened = await openAdminConsole(request, deps);
  if (!opened.ok) return opened.result;
  try {
    const bounds = periodBounds(parsed.query, new Date());
    const snapshot = await readOverviewSnapshot(opened.runtime.db, {
      currency: parsed.query.currency,
      mode: parsed.query.mode,
      start: bounds.start,
      end: bounds.end,
      nowMs: Date.now(),
    });
    const missing = snapshot.value.capped ? [ADMIN_REASON.accountCap] : [];
    return adminSuccess(
      adminEnvelope({
        data: snapshot.value.overview,
        scope: adminScopeFromQuery(parsed.query),
        mode: parsed.query.mode,
        cursor: snapshot.cursor,
        financeRevision: snapshot.value.overview.financeRevision,
        missingSources: missing,
        coverage: {
          included: snapshot.value.overview.included,
          total: snapshot.value.overview.total,
          excluded: snapshot.value.accounts
            .filter((account) => !account.included)
            .map((account) => ({ id: account.id, reason: account.reason ?? "EXCLUDED" })),
        },
      }),
      "postgres",
    );
  } finally {
    await deps.disposeRuntimeDb(opened.runtime);
  }
}
