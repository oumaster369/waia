import { sql } from "drizzle-orm";
import {
  adminClientError,
  adminSuccess,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import { openAdminConsole } from "./guard";
import { HANDLER_TABLES } from "../handler-tables";
import { withAdminRouteSnapshot } from "../repositories/snapshot.postgres";
import { adminEnvelope } from "../data-state";
import { adminScopeFromQuery, parseAdminConsoleQuery } from "../scope";
import { RETENTION_DAYS } from "../collectors/schedule";
export async function handleAdminConsoleChangesGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const url = new URL(request.url),
    parsed = parseAdminConsoleQuery(url);
  if (!parsed.ok) return parsed.result;
  const since = url.searchParams.get("since");
  if (since && (!/^\d{4}-\d{2}-\d{2}T/.test(since) || !Number.isFinite(Date.parse(since))))
    return adminClientError(400, "BAD_REQUEST", "since must be an ISO timestamp.");
  const opened = await openAdminConsole(request, deps, { requiredTables: HANDLER_TABLES.changes });
  if (!opened.ok) return opened.result;
  try {
    return await withAdminRouteSnapshot(opened.runtime.db, async (tx) => {
      const owner = url.searchParams.get("admin_user_id");
      if (owner && owner !== opened.userId)
        return adminClientError(404, "NOT_FOUND", "Visit marker not found.");
      const scope = adminScopeFromQuery(parsed.query);
      const respond = (data: unknown, missingSources: string[] = []) =>
        adminSuccess(
          adminEnvelope({ data, scope, mode: parsed.query.mode, missingSources }),
          "postgres",
        );
      if (scope.kind === "account")
        return respond({
          state: "not_applicable",
          reasons: ["CHANGE_ACCOUNT_BINDING_NOT_PERSISTED"],
        });
      const markers = [
        ...(await tx.execute(
          sql`SELECT previous_seen_at,last_seen_at FROM trader_admin_visit_marker WHERE admin_user_id=${opened.userId}::uuid LIMIT 1`,
        )),
      ];
      const marker = markers[0]?.previous_seen_at;
      const start = since ?? (marker ? new Date(String(marker)).toISOString() : null);
      if (!start)
        return respond({ state: "unavailable", reasons: ["PREVIOUS_VISIT_NOT_RECORDED"] });
      const cutoff = new Date(Date.now() - RETENTION_DAYS.changeLog * 86400000).toISOString();
      const partial = Date.parse(start) < Date.parse(cutoff),
        effectiveStart = partial ? cutoff : start;
      const rows = [
        ...(await tx.execute(sql`SELECT source_table,op,entity_id,organization_id::text,entity_version::text,changed_at::text,seq::text,count(*) OVER()::text AS total
     FROM trader_admin_change_log WHERE changed_at>=${effectiveStart}::timestamptz
     AND (${parsed.query.organization_id ?? null}::uuid IS NULL OR organization_id=${parsed.query.organization_id ?? null}::uuid)
     ORDER BY changed_at DESC,seq DESC LIMIT ${parsed.query.limit}`)),
      ];
      const total = Number(rows[0]?.total ?? 0);
      return respond(
        {
          state: partial ? "partial" : rows.length ? "ok" : "empty",
          since: start,
          effectiveSince: effectiveStart,
          items: rows.map((r) => ({
            id: String(r.seq),
            source: String(r.source_table),
            operation: String(r.op),
            entityId: String(r.entity_id),
            organizationId: r.organization_id,
            at: String(r.changed_at),
          })),
          aggregate: { total },
          truncated: total > rows.length,
          reasons: partial ? ["CHANGE_HISTORY_RETENTION_LIMIT"] : [],
        },
        partial ? ["CHANGE_HISTORY_RETENTION_LIMIT"] : [],
      );
    });
  } finally {
    await deps.disposeRuntimeDb(opened.runtime);
  }
}
