import { sql } from "drizzle-orm";
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
const iso = (v: unknown) =>
  v instanceof Date ? v.toISOString() : v == null ? null : new Date(String(v)).toISOString();
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
      const rows =
        await tx.execute(sql`SELECT id::text,strategy_id,strategy_version,state::text,state_version,requested_at,effective_at,cooling_off_ends_at,evidence_content_digest,record_content_digest
     FROM trader_strategy_promotion_records WHERE organization_id=${parsed.query.organization_id}::uuid AND strategy_id=${strategy}
     AND state IN ('PENDING_CONFIRM','COOLING_OFF','EFFECTIVE') ORDER BY requested_at DESC NULLS LAST,id LIMIT 4`);
      const records = (Array.isArray(rows) ? rows : []).map((r) => ({
        id: String(r.id),
        strategyId: String(r.strategy_id),
        strategyVersion: String(r.strategy_version),
        state: String(r.state),
        stateVersion: Number(r.state_version),
        revision: `promotion:${r.id}:${r.state_version}`,
        requestedAt: iso(r.requested_at),
        effectiveAt: iso(r.effective_at),
        coolingOffEndsAt: iso(r.cooling_off_ends_at),
        evidenceDigest: String(r.evidence_content_digest),
        recordDigest: String(r.record_content_digest),
      }));
      const pending = records.filter((r) => r.state !== "EFFECTIVE"),
        effective = records.filter((r) => r.state === "EFFECTIVE");
      if (pending.length > 1 || effective.length > 1)
        return adminSuccess(
          adminEnvelope({
            data: { state: "unavailable", reasons: ["PROMOTION_STATE_AMBIGUOUS"] },
            scope: adminScopeFromQuery(parsed.query),
            mode: parsed.query.mode,
          }),
          "postgres",
        );
      return adminSuccess(
        adminEnvelope({
          data: { pending: pending[0] ?? null, effective: effective[0] ?? null },
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
