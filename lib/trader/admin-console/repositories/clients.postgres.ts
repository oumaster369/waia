import { sql } from "drizzle-orm";

import {
  adminSuccess,
  adminClientError,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import { presentClient } from "@/lib/trader/admin-console/billing/clients";
import { adminEnvelope } from "@/lib/trader/admin-console/data-state";
import { adminScopeFromQuery } from "@/lib/trader/admin-console/scope";
import { decodePageCursor, encodePageCursor } from "@/lib/trader/admin-console/cursor";

function rowsOf(result: unknown): Record<string, unknown>[] {
  return Array.isArray(result) ? (result as Record<string, unknown>[]) : [];
}

function flag(value: unknown): boolean {
  return value === true || value === "t" || value === "true" || value === 1;
}

function iso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "string" || value.length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

import type { AdminReadTx } from "@/lib/trader/admin-console/repositories/snapshot.postgres";
import type { AdminConsoleQuery } from "@/lib/trader/admin-console/scope";

export async function readConsoleClients(
  tx: AdminReadTx,
  query: AdminConsoleQuery,
  clientId?: string,
): Promise<AdminRouteHandlerResult> {
  const cursor = !clientId && query.cursor ? decodePageCursor(query.cursor) : null;
  const organizationId = query.organization_id ?? null;
  const rows = rowsOf(
    await tx.execute(sql`
    WITH eligible AS (SELECT o.id::text AS id,
           o.created_at AS organization_created_at,
           o.created_at::text AS pagination_created_at,
           count(*) OVER ()::integer AS total,
           COALESCE(o.name, '') AS name,
           u.email AS owner_email,
           u.created_at AS registered_at,
           EXISTS (
             SELECT 1 FROM organization_entitlements e
             WHERE e.organization_id = o.id
               AND e.entitlement_key = 'trader'
               AND e.enabled
           ) AS entitlement_enabled,
           EXISTS (
             SELECT 1 FROM trader_invoices i WHERE i.organization_id = o.id
           ) AS has_invoice,
           EXISTS (
             SELECT 1 FROM exchange_credentials c WHERE c.organization_id = o.id
           ) AS has_credential,
           EXISTS (
             SELECT 1 FROM trader_invoices i
             WHERE i.organization_id = o.id AND i.status = 'ISSUED'
           ) AS has_debt,
           EXISTS (
             SELECT 1 FROM trader_position_lots l
             WHERE l.organization_id = o.id AND l.state = 'OPEN'
           ) AS has_open_lots,
           (
             SELECT MIN(obs.recorded_at)
             FROM trader_account_observations obs
             WHERE obs.organization_id = o.id
               AND obs.payload->>'status' = 'COMPLETE' AND obs.payload->'balances'->>'status' = 'COMPLETE'
           ) AS first_connected_at
    FROM organizations o
    JOIN users u ON u.id = o.owner_user_id
    WHERE (
      ${organizationId}::uuid IS NULL OR o.id = ${organizationId}::uuid
    )
    AND (${clientId ?? null}::uuid IS NULL OR o.id = ${clientId ?? null}::uuid)
    AND (${query.exchange_account_id ?? null}::text IS NULL OR EXISTS (
      SELECT 1 FROM exchange_credentials scoped_credential
      WHERE scoped_credential.organization_id = o.id
        AND scoped_credential.exchange_account_id = ${query.exchange_account_id ?? null}
    ) OR EXISTS (
      SELECT 1 FROM trader_invoices scoped_invoice
      WHERE scoped_invoice.organization_id = o.id
        AND scoped_invoice.exchange_account_id = ${query.exchange_account_id ?? null}
    ))
    AND (
      EXISTS (
        SELECT 1 FROM organization_entitlements e
        WHERE e.organization_id = o.id AND e.entitlement_key = 'trader' AND e.enabled
      )
      OR EXISTS (SELECT 1 FROM trader_invoices i WHERE i.organization_id = o.id)
      OR EXISTS (SELECT 1 FROM exchange_credentials c WHERE c.organization_id = o.id)
      OR EXISTS (
        SELECT 1 FROM trader_invoices i
        WHERE i.organization_id = o.id AND i.status = 'ISSUED'
      )
      OR EXISTS (
        SELECT 1 FROM trader_position_lots l
        WHERE l.organization_id = o.id AND l.state = 'OPEN'
      )
    )
    ) SELECT * FROM eligible
    WHERE (${cursor?.t ?? null}::timestamptz IS NULL
      OR organization_created_at < ${cursor?.t ?? null}::timestamptz
      OR (organization_created_at = ${cursor?.t ?? null}::timestamptz AND id < ${cursor?.id ?? null}))
    ORDER BY organization_created_at DESC, id DESC
    LIMIT ${query.limit + 1}
  `),
  );
  const items = rows.slice(0, query.limit).flatMap((row) => {
    const client = presentClient({
      id: String(row.id),
      name: String(row.name ?? ""),
      ownerEmail: String(row.owner_email ?? ""),
      registeredAt: iso(row.registered_at),
      firstConnectedAt: iso(row.first_connected_at),
      entitlementEnabled: flag(row.entitlement_enabled),
      hasInvoice: flag(row.has_invoice),
      hasCredential: flag(row.has_credential),
      hasDebt: flag(row.has_debt),
      hasOpenLots: flag(row.has_open_lots),
    });
    return client ? [client] : [];
  });
  if (clientId && !items.length)
    return adminClientError(404, "NOT_FOUND", "Client not found in scope.");
  return adminSuccess(
    adminEnvelope({
      data: clientId
        ? { client: items[0] }
        : {
            items,
            aggregate: { total: rows[0]?.total ?? (cursor ? null : 0) },
            truncated: rows.length > query.limit,
            nextCursor:
              rows.length > query.limit
                ? encodePageCursor({
                    t: String(rows[query.limit - 1]!.pagination_created_at),
                    id: String(rows[query.limit - 1]!.id),
                  })
                : null,
          },
      scope: adminScopeFromQuery(query),
      mode: query.mode,
    }),
    "postgres",
  );
}
