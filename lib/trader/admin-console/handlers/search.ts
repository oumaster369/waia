import { sql } from "drizzle-orm";

import {
  adminClientError,
  adminSuccess,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import { openAdminConsole } from "@/lib/trader/admin-console/handlers/guard";
import { ADMIN_REASON } from "@/lib/trader/admin-console/reason-codes";
import { parseAdminConsoleQuery } from "@/lib/trader/admin-console/scope";

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
  if (query.length < 2) {
    return adminClientError(
      400,
      ADMIN_REASON.queryTooShort,
      "Query must be at least 2 characters.",
    );
  }
  const opened = await openAdminConsole(request, deps);
  if (!opened.ok) return opened.result;
  const pattern = likePattern(query);
  try {
    const db = opened.runtime.db;
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
          SELECT id::text AS id, COALESCE(name, id::text) AS label, kind AS sublabel
          FROM organizations
          WHERE name ILIKE ${pattern} OR id::text ILIKE ${pattern}
          LIMIT 5
        `),
      db.execute(sql`
          SELECT id::text AS id, email AS label, NULL::text AS sublabel
          FROM users
          WHERE email ILIKE ${pattern}
          LIMIT 5
        `),
      db.execute(sql`
          SELECT id::text AS id, exchange_account_id AS label, organization_id::text AS sublabel
          FROM exchange_credentials
          WHERE exchange_account_id ILIKE ${pattern}
          LIMIT 5
        `),
      db.execute(sql`
          SELECT id::text AS id, id::text AS label, organization_id::text AS sublabel
          FROM trader_invoices
          WHERE id::text ILIKE ${pattern}
          LIMIT 5
        `),
      db.execute(sql`
          SELECT id::text AS id, settlement_tx_hash AS label, organization_id::text AS sublabel
          FROM payment_events
          WHERE settlement_tx_hash ILIKE ${pattern}
          LIMIT 5
        `),
      db.execute(sql`
          SELECT id::text AS id,
                 COALESCE(exchange_order_id, client_order_id, id::text) AS label,
                 organization_id::text AS sublabel
          FROM trader_orders
          WHERE id::text ILIKE ${pattern}
             OR exchange_order_id ILIKE ${pattern}
             OR client_order_id ILIKE ${pattern}
          LIMIT 5
        `),
      db.execute(sql`
          SELECT id::text AS id, strategy_id AS label, strategy_version AS sublabel
          FROM trader_strategy_promotion_records
          WHERE strategy_id ILIKE ${pattern} OR strategy_version ILIKE ${pattern} OR id::text ILIKE ${pattern}
          LIMIT 5
        `),
      db.execute(sql`
          SELECT id::text AS id, id::text AS label, strategy_id AS sublabel
          FROM trader_backtest_runs
          WHERE id::text ILIKE ${pattern} OR strategy_id ILIKE ${pattern}
          LIMIT 5
        `),
      db.execute(sql`
          SELECT id::text AS id, title AS label, fingerprint AS sublabel
          FROM trader_admin_incident
          WHERE title ILIKE ${pattern} OR fingerprint ILIKE ${pattern} OR id::text ILIKE ${pattern}
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
    return adminSuccess({ groups: GROUPS, results: grouped }, "postgres");
  } finally {
    await deps.disposeRuntimeDb(opened.runtime);
  }
}
