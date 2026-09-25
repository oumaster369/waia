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
import {
  adminScopeFromQuery,
  parseAdminConsoleQuery,
  periodBounds,
} from "@/lib/trader/admin-console/scope";

export async function handleAdminConsoleNewsGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const parsed = parseAdminConsoleQuery(new URL(request.url));
  if (!parsed.ok) return parsed.result;
  const opened = await openAdminConsole(request, deps, { requiredTables: HANDLER_TABLES.news });
  if (!opened.ok) return opened.result;
  try {
    return await withAdminRouteSnapshot(opened.runtime.db, async (tx) => {
      const bounds = periodBounds(parsed.query, new Date());
      const result =
        await tx.execute(sql`SELECT n.id::text,n.source,n.url,n.published_at,n.first_observed_at,n.symbols,n.category,v.title,v.summary,v.observed_at
        FROM trader_admin_news_item n JOIN trader_admin_news_item_version v ON v.news_item_id=n.id AND v.version=n.current_version
        WHERE COALESCE(n.published_at,n.first_observed_at)>=${bounds.start}::timestamptz AND COALESCE(n.published_at,n.first_observed_at)<${bounds.end}::timestamptz
        ORDER BY COALESCE(n.published_at,n.first_observed_at) DESC,n.id LIMIT ${parsed.query.limit + 1}`);
      const rows = [...result];
      return adminSuccess(
        adminEnvelope({
          scope: adminScopeFromQuery(parsed.query),
          mode: parsed.query.mode,
          data: {
            items: rows
              .slice(0, parsed.query.limit)
              .map((row) => ({
                id: String(row.id),
                source: String(row.source),
                url: /^https?:\/\//i.test(String(row.url)) ? String(row.url) : null,
                title: String(row.title),
                summary: row.summary == null ? null : String(row.summary),
                symbols: row.symbols,
                publishedAt: row.published_at
                  ? new Date(String(row.published_at)).toISOString()
                  : null,
                observedAt: new Date(String(row.observed_at)).toISOString(),
              })),
            scopeLabel: "Общие рыночные новости",
            truncated: rows.length > parsed.query.limit,
          },
        }),
        "postgres",
      );
    });
  } finally {
    await deps.disposeRuntimeDb(opened.runtime);
  }
}
