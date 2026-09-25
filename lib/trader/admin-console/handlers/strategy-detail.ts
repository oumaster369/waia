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
import { adminScopeFromQuery, parseAdminConsoleQuery, periodBounds } from "../scope";
import { organizationFilter } from "../sql/read-scope";
import { legScopeFilter } from "../sql/leg-scope-filter";
import {
  cycleProjection,
  cycleModeScopeFilter,
} from "@/lib/trader/admin-console/sql/cycle-projection";
import { verifiedCloseFee } from "../money/verified-close-fee";
import {
  strategyPerformance,
  type StrategyPerformanceTrade,
} from "../research/strategy-performance";
import { noTradeCategory } from "../research/no-trade-map";
const rows = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v : []);
const iso = (v: unknown) =>
  v instanceof Date ? v.toISOString() : v == null ? null : new Date(String(v)).toISOString();
export async function handleAdminConsoleStrategyDetailGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const url = new URL(request.url),
    parsed = parseAdminConsoleQuery(url);
  if (!parsed.ok) return parsed.result;
  const strategy = url.searchParams.get("strategy_id"),
    version = url.searchParams.get("strategy_version");
  if (!strategy || !version || strategy.length > 200 || version.length > 200)
    return adminClientError(400, "BAD_REQUEST", "Strategy and version required.");
  const opened = await openAdminConsole(request, deps, {
    requiredTables: HANDLER_TABLES.strategyDetail,
  });
  if (!opened.ok) return opened.result;
  try {
    return await withAdminRouteSnapshot(opened.runtime.db, async (tx) => {
      const query = parsed.query,
        bounds = periodBounds(query, new Date()),
        modes = query.mode === "all" ? (["live", "paper", "history"] as const) : [query.mode];
      const performance = [];
      for (const mode of modes) {
        const scoped = { ...query, mode };
        const raw = rows(
          await tx.execute(sql`WITH selected AS (
        SELECT t.id,t.organization_id,t.account_key,t.symbol,t.state,t.closed_at FROM trader_trades t
        WHERE ${organizationFilter(query, "t")} AND t.strategy_id=${strategy} AND t.strategy_version=${version}
        AND ${legScopeFilter(scoped, "trade", "t")} AND t.opened_at<${bounds.end}::timestamptz AND (t.closed_at IS NULL OR t.closed_at>=${bounds.start}::timestamptz)
        ORDER BY t.id LIMIT 5001)
        SELECT t.id::text AS trade_id,t.organization_id::text,t.account_key,t.symbol,t.state,t.closed_at,
          l.id::text AS leg_id,l.kind,l.executed_at,l.leg_pnl,l.quantity,l.fee,l.price,f.fee_asset,c.exchange_account_id,
          EXISTS(SELECT 1 FROM exchange_credentials other WHERE other.venue=c.venue AND other.exchange_account_id=c.exchange_account_id AND other.organization_id<>c.organization_id) AS ownership_conflict,
          (SELECT array_agg(e.payload) FROM trader_lifecycle_events e WHERE e.organization_id=l.organization_id AND e.entity_type='FILL' AND e.entity_id=l.fill_id::text AND e.phase='ORDER_FILLED') AS fee_evidence
        FROM selected t LEFT JOIN trader_trade_legs l ON l.trade_id=t.id AND l.organization_id=t.organization_id
        LEFT JOIN trader_orders o ON o.id=l.order_id AND o.organization_id=l.organization_id
        LEFT JOIN exchange_credentials c ON c.id=o.credential_id AND c.organization_id=o.organization_id
        LEFT JOIN trader_fills f ON f.id=l.fill_id AND f.organization_id=l.organization_id AND f.order_id=o.id
        ORDER BY t.id,l.executed_at,l.id LIMIT 50001`),
        );
        const trades = new Map<string, StrategyPerformanceTrade>();
        for (const r of raw) {
          const id = String(r.trade_id);
          let trade = trades.get(id);
          if (!trade) {
            trade = {
              id,
              organizationId: String(r.organization_id),
              account:
                r.exchange_account_id == null
                  ? String(r.account_key)
                  : String(r.exchange_account_id),
              symbol: String(r.symbol),
              state: String(r.state),
              closedAt: iso(r.closed_at),
              legs: [],
              reasons: [],
            };
            trades.set(id, trade);
          }
          if (r.ownership_conflict) {
            trade.reasons.push("OWNERSHIP_CONFLICT");
            continue;
          }
          if (!r.leg_id) {
            trade.reasons.push("TRADE_LEGS_NOT_PERSISTED");
            continue;
          }
          if (!["OPEN_FILL", "CLOSE_FILL"].includes(String(r.kind))) {
            trade.reasons.push("LIVE_LEG_KIND_UNSUPPORTED");
            continue;
          }
          if (!trade.symbol.toUpperCase().endsWith("USDT")) {
            trade.reasons.push("TRADE_QUOTE_NOT_USDT");
            continue;
          }
          if (r.fee_asset == null) {
            trade.reasons.push("FEE_ASSET_UNCONVERTIBLE");
            continue;
          }
          trade.legs.push({
            kind: r.kind === "OPEN_FILL" ? "OPEN" : "CLOSE",
            executedAt: iso(r.executed_at)!,
            legPnl: String(r.leg_pnl),
            fee: String(r.fee),
            price: String(r.price),
            feeAsset: String(r.fee_asset),
            baseAsset: trade.symbol
              .toUpperCase()
              .slice(0, -4)
              .replace(/[/_-]$/, ""),
            quoteAsset: "USDT",
            verifiedCloseFeeQuote: verifiedCloseFee(r),
          });
        }
        for (const trade of trades.values())
          if (trade.state !== "OPEN" && !trade.legs.some((l) => l.kind === "CLOSE"))
            trade.reasons.push("TRADE_CLOSURE_LEGS_MISSING");
        performance.push({
          mode,
          ...strategyPerformance(
            [...trades.values()],
            bounds.start,
            bounds.end,
            trades.size > 5000 || raw.length > 50000,
          ),
        });
      }
      const decisions = rows(
        await tx.execute(sql`WITH cycles AS (${cycleProjection(query)})
      SELECT d.id::text,d.cycle_envelope_id::text,d.organization_id::text,d.symbol,d.decision_class,d.universal_terminal_reason_code,d.evaluated_at,c.mode
      FROM trader_intelligence_decision_record d JOIN cycles c ON c.id=d.cycle_envelope_id AND c.organization_id=d.organization_id
      WHERE d.strategy_id=${strategy} AND d.strategy_version=${version} AND ${cycleModeScopeFilter(query, "c")}
      AND d.evaluated_at>=${bounds.start}::timestamptz AND d.evaluated_at<${bounds.end}::timestamptz ORDER BY d.evaluated_at DESC,d.id LIMIT 51`),
      );
      return adminSuccess(
        adminEnvelope({
          data: {
            strategyId: strategy,
            version,
            period: bounds,
            performance,
            decisions: decisions.slice(0, 50).map((r) => ({
              id: String(r.id),
              cycleId: String(r.cycle_envelope_id),
              organizationId: String(r.organization_id),
              symbol: String(r.symbol),
              decision: String(r.decision_class),
              reason: String(r.universal_terminal_reason_code),
              category: noTradeCategory(String(r.universal_terminal_reason_code)),
              at: iso(r.evaluated_at),
              mode: String(r.mode),
            })),
            decisionsTruncated: decisions.length > 50,
            returnPct: { state: "unavailable", reason: "RETURN_METHOD_NOT_RATIFIED" },
            unrealized: {
              state: "unavailable",
              reason: "STRATEGY_UNREALIZED_PERIOD_BINDING_NOT_PERSISTED",
            },
          },
          scope: adminScopeFromQuery(query),
          mode: query.mode,
        }),
        "postgres",
      );
    });
  } finally {
    await deps.disposeRuntimeDb(opened.runtime);
  }
}
