import { sql } from "drizzle-orm";
import {
  adminSuccess,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import { openAdminConsole } from "./guard";
import { HANDLER_TABLES } from "../handler-tables";
import { withAdminRouteSnapshot } from "../repositories/snapshot.postgres";
import { adminEnvelope } from "../data-state";
import { adminScopeFromQuery, parseAdminConsoleQuery } from "../scope";
import { addDecimal } from "@/lib/trader/risk/numeric";
export async function handleAdminConsolePaperPortfoliosGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const parsed = parseAdminConsoleQuery(new URL(request.url));
  if (!parsed.ok) return parsed.result;
  const opened = await openAdminConsole(request, deps, {
    requiredTables: HANDLER_TABLES.paperPortfolios,
  });
  if (!opened.ok) return opened.result;
  try {
    return await withAdminRouteSnapshot(opened.runtime.db, async (tx) => {
      const scope = adminScopeFromQuery(parsed.query);
      const respond = (data: unknown) =>
        adminSuccess(adminEnvelope({ data, scope, mode: parsed.query.mode }), "postgres");
      if (scope.kind === "account")
        return respond({
          state: "not_applicable",
          reasons: ["PAPER_PORTFOLIO_NOT_EXCHANGE_ACCOUNT"],
        });
      if (!["paper", "all"].includes(parsed.query.mode))
        return respond({
          items: [],
          state: "not_applicable",
          reasons: ["PAPER_PORTFOLIO_OTHER_MODE"],
        });
      const org = parsed.query.organization_id ?? null;
      const books = [
        ...(await tx.execute(sql`WITH bindings AS (
    SELECT o.organization_id, o.id, o.updated_at, COALESCE(p.account_id,l.account_key) AS account_key
    FROM trader_orders o LEFT JOIN trader_execution_plans_v2 p ON p.id=o.execution_plan_id AND p.organization_id=o.organization_id
    LEFT JOIN LATERAL (SELECT CASE WHEN count(DISTINCT lot.account_key)=1 THEN min(lot.account_key) ELSE NULL END AS account_key
      FROM trader_trade_legs leg JOIN trader_position_lots lot ON lot.id=leg.position_lot_id AND lot.organization_id=leg.organization_id
      WHERE leg.order_id=o.id AND leg.organization_id=o.organization_id) l ON true
    WHERE o.execution_mode='paper' AND o.historical_run_id IS NULL AND o.credential_id IS NULL
      AND (${org}::uuid IS NULL OR o.organization_id=${org}::uuid)
   ) SELECT organization_id::text,account_key,count(*)::text AS order_count,max(updated_at)::text AS observed_at
    FROM bindings GROUP BY organization_id,account_key ORDER BY organization_id,account_key NULLS LAST LIMIT 101`)),
      ];
      const lots = [
        ...(await tx.execute(sql`SELECT l.id::text,l.organization_id::text,l.account_key,l.symbol,l.remaining_qty::text
    FROM trader_position_lots l WHERE l.state='OPEN' AND (${org}::uuid IS NULL OR l.organization_id=${org}::uuid)
    AND EXISTS(SELECT 1 FROM trader_trade_legs leg JOIN trader_orders o ON o.id=leg.order_id AND o.organization_id=leg.organization_id
       WHERE leg.position_lot_id=l.id AND leg.organization_id=l.organization_id AND o.execution_mode='paper' AND o.historical_run_id IS NULL AND o.credential_id IS NULL)
    AND NOT EXISTS(SELECT 1 FROM trader_trade_legs leg LEFT JOIN trader_orders o ON o.id=leg.order_id AND o.organization_id=leg.organization_id
       WHERE leg.position_lot_id=l.id AND leg.organization_id=l.organization_id AND (o.id IS NULL OR o.execution_mode<>'paper' OR o.historical_run_id IS NOT NULL OR o.credential_id IS NOT NULL))
    ORDER BY l.organization_id,l.account_key,l.id LIMIT 5001`)),
      ];
      const capped = books.length > 100 || lots.length > 5000;
      return respond({
        state: capped ? "partial" : books.length ? "ok" : "empty",
        reasons: capped ? ["PAPER_PORTFOLIO_CAP"] : [],
        items: books.slice(0, 100).map((b) => {
          const qty = new Map<string, string>();
          if (!capped && b.account_key)
            for (const l of lots.filter(
              (l) => l.organization_id === b.organization_id && l.account_key === b.account_key,
            ))
              qty.set(
                String(l.symbol),
                addDecimal(qty.get(String(l.symbol)) ?? "0", String(l.remaining_qty)),
              );
          return {
            id: `paper:${b.organization_id}:${b.account_key ?? "unbound"}`,
            organizationId: String(b.organization_id),
            accountKey: b.account_key ? String(b.account_key) : null,
            portfolio: "paper",
            activity: "paper",
            deployment: null,
            tradePermission: "not_applicable",
            orderCount: Number(b.order_count),
            observedAt: String(b.observed_at),
            cash: null,
            equity: null,
            currency: parsed.query.currency,
            state: "partial",
            reasons: [
              "PAPER_INITIAL_CASH_NOT_PERSISTED",
              ...(!b.account_key ? ["PAPER_ACCOUNT_BINDING_NOT_PERSISTED"] : []),
              ...(capped ? ["PAPER_PORTFOLIO_CAP"] : []),
            ],
            positions:
              capped || !b.account_key
                ? null
                : [...qty].map(([symbol, quantity]) => ({ symbol, quantity })),
          };
        }),
      });
    });
  } finally {
    await deps.disposeRuntimeDb(opened.runtime);
  }
}
