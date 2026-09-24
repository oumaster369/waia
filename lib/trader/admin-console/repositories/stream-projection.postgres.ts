import { sql } from "drizzle-orm";
import type { AdminReadTx } from "@/lib/trader/admin-console/repositories/snapshot.postgres";
import { periodBounds, type AdminConsoleQuery } from "@/lib/trader/admin-console/scope";
import { presentConsoleOrder } from "@/lib/trader/admin-console/read-models/order";
import { orderScopeFilter } from "@/lib/trader/admin-console/sql/order-scope-filter";
import { orderVisibleInMode } from "@/lib/trader/admin-console/sql/order-mode-filter";
import {
  projectChangeRow,
  type ChangeLogRow,
  type ProjectedChange,
} from "@/lib/trader/admin-console/stream/protocol";

/** The same safe DTO as HTTP; never forward a database row or credential payload. */
export async function projectScopedChanges(
  tx: AdminReadTx,
  rows: readonly ChangeLogRow[],
  query: AdminConsoleQuery,
): Promise<Map<string, ProjectedChange | null>> {
  const bounds = periodBounds(query, new Date());
  const scoped = rows.filter(
    (row) =>
      !query.organization_id ||
      row.organizationId === query.organization_id ||
      (row.organizationId === null &&
        [
          "trader_kill_switches",
          "trader_admin_incident",
          "trader_admin_job_run",
          "trader_admin_market_quote_latest",
          "trader_admin_fear_greed",
          "trader_admin_news_item",
        ].includes(row.sourceTable)),
  );
  const orderIds = scoped.filter((r) => r.sourceTable === "trader_orders").map((r) => r.entityId);
  const orders = orderIds.length
    ? await tx.execute(sql`
    SELECT o.id::text AS id, o.organization_id::text AS organization_id, o.execution_mode,
           o.historical_run_id, o.symbol, o.side, o.state, o.quantity, o.filled_quantity,
           o.client_order_id, o.exchange_order_id, o.created_at::text AS created_at
    FROM trader_orders o
    WHERE o.id::text = ANY(string_to_array(${orderIds.join(",")}, ','))
      AND ${orderScopeFilter(query, "o")}
      AND ${orderVisibleInMode(query.mode, true)}
      AND (${query.tab ?? "working"} <> 'all' OR (o.created_at >= ${bounds.start}::timestamptz AND o.created_at < ${bounds.end}::timestamptz))
  `)
    : [];
  const byOrder = new Map(
    (orders as Record<string, unknown>[]).map((r) => [String(r.id), presentConsoleOrder(r)]),
  );
  const credentialIds = scoped
    .filter((r) => r.sourceTable === "exchange_credentials")
    .map((r) => r.entityId);
  const credentials = credentialIds.length
    ? await tx.execute(sql`
    SELECT id::text AS id, organization_id::text AS organization_id, exchange_account_id, revoked_at
    FROM exchange_credentials WHERE id::text = ANY(string_to_array(${credentialIds.join(",")}, ','))
  `)
    : [];
  const byCredential = new Map(
    (credentials as Record<string, unknown>[]).map((r) => [String(r.id), r]),
  );
  const output = new Map<string, ProjectedChange | null>();
  for (const row of rows) output.set(row.seq, null);
  for (const row of scoped) {
    const projected = projectChangeRow(row);
    if (!projected) continue;
    if (row.sourceTable === "trader_orders") {
      const order = byOrder.get(row.entityId);
      if (order) output.set(row.seq, { ...projected, payload: order });
      // Deleted/unbound entities cannot prove account or mode membership. A scoped
      // snapshot invalidation refreshes them without disclosing an unrelated id.
      else if (!query.exchange_account_id && query.mode === "all")
        output.set(row.seq, { ...projected, removed: true });
      else
        output.set(row.seq, {
          ...projected,
          removed: false,
          invalidation: true,
          entityId: "orders:scope",
          payload: { reason: "source_changed" },
        });
    } else if (row.sourceTable === "exchange_credentials") {
      const credential = byCredential.get(row.entityId);
      if (
        query.exchange_account_id &&
        credential?.exchange_account_id !== query.exchange_account_id
      )
        continue;
      output.set(row.seq, { ...projected, removed: !credential || credential.revoked_at != null });
    } else {
      // These are explicit invalidations. Their models are read through scoped HTTP,
      // not synthesized from the trigger's identifier-only journal.
      output.set(row.seq, {
        ...projected,
        invalidation: true,
        entityId: `${projected.topic}:scope`,
        payload: { reason: "source_changed" },
      });
    }
  }
  return output;
}
