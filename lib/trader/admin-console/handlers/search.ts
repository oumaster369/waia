import { withAdminRouteSnapshot } from "@/lib/trader/admin-console/repositories/snapshot.postgres";
import { sql } from "drizzle-orm";

import {
  adminClientError,
  adminSuccess,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import { HANDLER_TABLES } from "@/lib/trader/admin-console/handler-tables";
import { openAdminConsole } from "@/lib/trader/admin-console/handlers/guard";
import { ADMIN_REASON } from "@/lib/trader/admin-console/reason-codes";
import { assistantHref } from "@/lib/trader/admin-console/assistant/context";
import { adminEnvelope } from "@/lib/trader/admin-console/data-state";
import {
  organizationFilter,
  exchangeAccountFilter,
} from "@/lib/trader/admin-console/sql/read-scope";
import { orderScopeFilter } from "@/lib/trader/admin-console/sql/order-scope-filter";
import { orderVisibleInMode } from "@/lib/trader/admin-console/sql/order-mode-filter";
import {
  adminScopeFromQuery,
  periodBounds,
  parseAdminConsoleQuery,
} from "@/lib/trader/admin-console/scope";

export type AdminSearchHit = {
  kind: string;
  id: string;
  label: string;
  sublabel: string | null;
  href: string;
};

const GROUPS = [
  "organizations",
  "owners",
  "accounts",
  "invoices",
  "payments",
  "orders",
  "strategies",
  "runs",
  "incidents",
] as const;

function likePattern(query: string): string {
  const stripped = query.replace(/[%_\\]/g, "").trim();
  return `%${stripped}%`;
}

function href(kind: string, id: string): string {
  return `/admin/${kind}?id=${encodeURIComponent(id)}`;
}

function rowsOf(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  return [];
}

function hit(kind: string, id: unknown, label: unknown, sublabel: unknown): AdminSearchHit | null {
  if (typeof id !== "string" || typeof label !== "string") return null;
  return {
    kind,
    id,
    label,
    sublabel: typeof sublabel === "string" ? sublabel : null,
    href: href(kind, id),
  };
}

export async function handleAdminConsoleSearchGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const url = new URL(request.url);
  const parsed = parseAdminConsoleQuery(url);
  if (!parsed.ok) return parsed.result;
  const query = parsed.query.q?.trim() ?? "";
  if (query.replace(/[%_\\]/g, "").trim().length < 2) {
    return adminClientError(
      400,
      ADMIN_REASON.queryTooShort,
      "Query must be at least 2 characters.",
    );
  }
  const opened = await openAdminConsole(request, deps, {
    requiredTables: HANDLER_TABLES.search,
  });
  if (!opened.ok) return opened.result;
  const pattern = likePattern(query);
  const q = parsed.query,
    bounds = periodBounds(q, new Date());
  const org = q.organization_id ?? null,
    account = q.exchange_account_id ?? null;
  const clientScope = sql`(${org}::uuid IS NULL OR o.id=${org}::uuid)
    AND (${account}::text IS NULL OR EXISTS(SELECT 1 FROM exchange_credentials c WHERE c.organization_id=o.id AND c.exchange_account_id=${account}) OR EXISTS(SELECT 1 FROM trader_invoices i WHERE i.organization_id=o.id AND i.exchange_account_id=${account}))
    AND (EXISTS(SELECT 1 FROM exchange_credentials c WHERE c.organization_id=o.id) OR EXISTS(SELECT 1 FROM trader_invoices i WHERE i.organization_id=o.id) OR EXISTS(SELECT 1 FROM organization_entitlements e WHERE e.organization_id=o.id AND e.entitlement_key='trader' AND e.enabled))`;
  try {
    return await withAdminRouteSnapshot(opened.runtime.db, async (tx) => {
      const db = tx;
      const [
        organizations,
        owners,
        accounts,
        invoices,
        payments,
        orders,
        strategies,
        runs,
        incidents,
      ] = await Promise.all([
        db.execute(sql`
          SELECT o.id::text AS id, COALESCE(o.name, o.id::text) AS label, o.kind AS sublabel
          FROM organizations o
          WHERE ${clientScope} AND (o.name ILIKE ${pattern} OR o.id::text ILIKE ${pattern})
          LIMIT 5
        `),
        db.execute(sql`
          SELECT o.id::text AS id, u.email AS label, o.name AS sublabel
          FROM users u JOIN organizations o ON o.owner_user_id=u.id
          WHERE ${clientScope} AND u.email ILIKE ${pattern}
          LIMIT 5
        `),
        db.execute(sql`
          SELECT venue || ':' || exchange_account_id AS id, exchange_account_id AS label, venue AS sublabel
          FROM exchange_credentials
          WHERE ${organizationFilter(q)} AND ${exchangeAccountFilter(q)} AND exchange_account_id ILIKE ${pattern}
          GROUP BY venue,exchange_account_id
          LIMIT 5
        `),
        db.execute(sql`
          SELECT id::text AS id, id::text AS label, organization_id::text AS sublabel
          FROM trader_invoices
          WHERE ${organizationFilter(q)} AND ${exchangeAccountFilter(q)} AND id::text ILIKE ${pattern}
            AND period_start < ${bounds.end}::timestamptz AND period_end >= ${bounds.start}::timestamptz
          LIMIT 5
        `),
        db.execute(sql`
          SELECT id::text AS id, settlement_tx_hash AS label, organization_id::text AS sublabel
          FROM payment_events
          WHERE subject_module='trader' AND ${organizationFilter(q)} AND settlement_tx_hash ILIKE ${pattern}
            AND (${account}::text IS NULL OR EXISTS(SELECT 1 FROM trader_invoices i WHERE i.id::text=payment_events.subject_invoice_id AND i.organization_id=payment_events.organization_id AND i.exchange_account_id=${account}))
            AND created_at >= ${bounds.start}::timestamptz AND created_at < ${bounds.end}::timestamptz
          LIMIT 5
        `),
        db.execute(sql`
          SELECT id::text AS id,
                 COALESCE(exchange_order_id, client_order_id, id::text) AS label,
                 organization_id::text AS sublabel
          FROM trader_orders
          WHERE ${orderScopeFilter(q, "trader_orders")} AND ${orderVisibleInMode(q.mode, false)}
            AND created_at >= ${bounds.start}::timestamptz AND created_at < ${bounds.end}::timestamptz
            AND (id::text ILIKE ${pattern} OR exchange_order_id ILIKE ${pattern} OR client_order_id ILIKE ${pattern})
          LIMIT 5
        `),
        db.execute(sql`
          SELECT strategy_id || ':' || strategy_version AS id, strategy_id AS label, strategy_version AS sublabel
          FROM trader_strategy_promotion_records
          WHERE ${organizationFilter(q)} AND ${account}::text IS NULL
            AND (strategy_id ILIKE ${pattern} OR strategy_version ILIKE ${pattern} OR id::text ILIKE ${pattern})
          LIMIT 5
        `),
        db.execute(sql`
          SELECT id::text AS id, id::text AS label, strategy_id AS sublabel
          FROM trader_backtest_runs
          WHERE ${organizationFilter(q)} AND ${account}::text IS NULL AND ${q.mode} IN ('all','history') AND split <> 'blind'
            AND created_at >= ${bounds.start}::timestamptz AND created_at < ${bounds.end}::timestamptz
            AND (id::text ILIKE ${pattern} OR strategy_id ILIKE ${pattern})
          LIMIT 5
        `),
        db.execute(sql`
          SELECT id::text AS id, title AS label, fingerprint AS sublabel
          FROM trader_admin_incident
          WHERE (${org}::uuid IS NULL OR EXISTS(SELECT 1 FROM trader_admin_diagnostic_event d WHERE d.environment=trader_admin_incident.environment AND d.service=trader_admin_incident.service AND d.fingerprint=trader_admin_incident.fingerprint AND d.organization_id=${org}::uuid AND (${account}::text IS NULL OR d.exchange_account_id=${account})))
            AND (title ILIKE ${pattern} OR fingerprint ILIKE ${pattern} OR id::text ILIKE ${pattern})
          LIMIT 5
        `),
      ]);
      const grouped = {
        organizations: rowsOf(organizations).flatMap((row) => {
          const item = hit("organizations", row.id, row.label, row.sublabel);
          return item ? [item] : [];
        }),
        owners: rowsOf(owners).flatMap((row) => {
          const item = hit("owners", row.id, row.label, row.sublabel);
          return item ? [item] : [];
        }),
        accounts: rowsOf(accounts).flatMap((row) => {
          const item = hit("accounts", row.id, row.label, row.sublabel);
          return item ? [item] : [];
        }),
        invoices: rowsOf(invoices).flatMap((row) => {
          const item = hit("invoices", row.id, row.label, row.sublabel);
          return item ? [item] : [];
        }),
        payments: rowsOf(payments).flatMap((row) => {
          const item = hit("payments", row.id, row.label, row.sublabel);
          return item ? [item] : [];
        }),
        orders: rowsOf(orders).flatMap((row) => {
          const item = hit("orders", row.id, row.label, row.sublabel);
          return item ? [item] : [];
        }),
        strategies: rowsOf(strategies).flatMap((row) => {
          const item = hit("strategies", row.id, row.label, row.sublabel);
          return item ? [item] : [];
        }),
        runs: rowsOf(runs).flatMap((row) => {
          const item = hit("runs", row.id, row.label, row.sublabel);
          return item ? [item] : [];
        }),
        incidents: rowsOf(incidents).flatMap((row) => {
          const item = hit("incidents", row.id, row.label, row.sublabel);
          return item ? [item] : [];
        }),
      };
      const paths: Record<string, { path: string; tab?: string; key: string }> = {
        organizations: { path: "/admin/clients", key: "sel" },
        owners: { path: "/admin/clients", key: "sel" },
        accounts: { path: "/admin/accounts", key: "sel" },
        invoices: { path: "/admin/clients", tab: "invoices", key: "sel" },
        payments: { path: "/admin/clients", tab: "payments", key: "sel" },
        orders: { path: "/admin/orders", tab: "all", key: "order" },
        strategies: { path: "/admin/strategies", key: "sel" },
        runs: { path: "/admin/research", tab: "runs", key: "sel" },
        incidents: { path: "/admin/errors", key: "sel" },
      };
      for (const [kind, hits] of Object.entries(grouped))
        for (const item of hits) {
          const destination = paths[kind];
          item.href = assistantHref(destination.path, q, {
            ...(destination.tab ? { tab: destination.tab } : {}),
            [destination.key]: item.id,
          });
        }
      return adminSuccess(
        adminEnvelope({
          data: {
            groups: GROUPS,
            results: grouped,
            coverage: { complete: false, reason: "SEARCH_GROUP_LIMIT" },
          },
          scope: adminScopeFromQuery(q),
          mode: q.mode,
        }),
        "postgres",
      );
    });
  } finally {
    await deps.disposeRuntimeDb(opened.runtime);
  }
}
