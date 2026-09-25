import {
  adminClientError,
  adminSuccess,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import { adminEnvelope } from "../data-state";
import { openAdminConsole } from "./guard";
import { adminScopeFromQuery, parseAdminConsoleQuery } from "../scope";
import { withAdminRouteSnapshot } from "../repositories/snapshot.postgres";
import {
  readResearchDetail,
  RESEARCH_DETAIL_TABLES,
} from "../repositories/research-detail.postgres";
import { compareResearchRuns } from "../research/compare-runs";

export async function handleAdminConsoleResearchDetailGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
  ids: readonly string[],
): Promise<AdminRouteHandlerResult> {
  const parsed = parseAdminConsoleQuery(new URL(request.url));
  if (!parsed.ok) return parsed.result;
  if (
    ids.length < 1 ||
    ids.length > 4 ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => id.length > 350)
  )
    return adminClientError(400, "BAD_REQUEST", "Choose one run, or 2–4 different runs.");
  const opened = await openAdminConsole(request, deps, { requiredTables: RESEARCH_DETAIL_TABLES });
  if (!opened.ok) return opened.result;
  try {
    return await withAdminRouteSnapshot(opened.runtime.db, async (tx) => {
      const runs = [];
      for (const id of ids) {
        const run = await readResearchDetail(tx, parsed.query, id);
        if (!run) return adminClientError(404, "NOT_FOUND", "Run not found in this scope.");
        runs.push(run);
      }
      const comparison =
        runs.length > 1
          ? compareResearchRuns(
              runs.map((r) => ({
                id: r.id,
                ...r.conditions,
                netPnl: r.metrics.netPnl,
                forecastQuality: r.metrics.forecastQuality,
              })),
            )
          : null;
      return adminSuccess(
        adminEnvelope({
          data: { items: runs, comparison },
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
