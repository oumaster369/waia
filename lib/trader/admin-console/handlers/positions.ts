import { createRequire } from "node:module";
import { sql } from "drizzle-orm";

import {
  adminSuccess,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import {
  attributeLegs,
  type AttributionCredential,
  type AttributionOrder,
} from "@/lib/trader/admin-console/attribution/trade-attribution";
import { decodePageCursor, encodePageCursor } from "@/lib/trader/admin-console/cursor";
import { adminEnvelope } from "@/lib/trader/admin-console/data-state";
import { HANDLER_TABLES } from "@/lib/trader/admin-console/handler-tables";
import { openAdminConsole } from "@/lib/trader/admin-console/handlers/guard";
import type { AdminMode } from "@/lib/trader/admin-console/contracts";
import { presentOpenLot } from "@/lib/trader/admin-console/read-models/positions";
import { adminScopeFromQuery, parseAdminConsoleQuery } from "@/lib/trader/admin-console/scope";
import { orderVisibleInMode } from "@/lib/trader/admin-console/sql/order-mode-filter";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") require("server-only");

function rowsOf(result: unknown): Record<string, unknown>[] {
  return Array.isArray(result) ? (result as Record<string, unknown>[]) : [];
}

function iso(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value))) {
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  return null;
}

function text(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function bps(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number.parseInt(value, 10);
  return null;
}

function countOf(value: unknown): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number.parseInt(value, 10);
  return 1;
}

export async function handleAdminConsolePositionsGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const parsed = parseAdminConsoleQuery(new URL(request.url));
  if (!parsed.ok) return parsed.result;
  const cursor = parsed.query.cursor ? decodePageCursor(parsed.query.cursor) : null;
  if (parsed.query.cursor && !cursor) {
    return {
      status: 400,
      outcome: "client_error",
      body: { error: { code: "BAD_REQUEST", message: "cursor is invalid." } },
    };
  }
  const opened = await openAdminConsole(request, deps, {
    requiredTables: HANDLER_TABLES.positions,
  });
  if (!opened.ok) return opened.result;
  const organizationId = parsed.query.organization_id ?? null;
  const cursorTime = cursor?.t ?? null;
  const cursorId = cursor?.id ?? null;
  const limit = parsed.query.limit;
  try {
    const rows = rowsOf(
      await opened.runtime.db.execute(sql`
        SELECT l.id::text AS id,
               l.organization_id::text AS organization_id,
               l.symbol,
               l.account_key,
               l.open_qty,
               l.remaining_qty,
               l.avg_cost,
               l.opened_at::text AS opened_at,
               g.recommendation,
               g.open_position_sufficiency,
               g.new_opportunity_sufficiency,
               g.target_reduction_bps,
               g.created_at AS guardian_at,
               r.posture AS risk_posture,
               groups.open_lot_count
        FROM trader_position_lots l
        LEFT JOIN LATERAL (
          SELECT DISTINCT ON (a.lot_id)
                 a.recommendation,
                 a.open_position_sufficiency,
                 a.new_opportunity_sufficiency,
                 a.target_reduction_bps,
                 a.created_at
          FROM trader_guardian_assessments_v2 a
          WHERE a.lot_id = l.id
            AND a.organization_id = l.organization_id
          ORDER BY a.lot_id, a.created_at DESC, a.assessment_id DESC
        ) g ON true
        LEFT JOIN trader_risk_account_state_v2 r
          ON r.organization_id = l.organization_id
         AND r.account_id = l.account_key
        LEFT JOIN (
          SELECT organization_id, symbol, account_key, count(*)::int AS open_lot_count
          FROM trader_position_lots
          WHERE state = 'OPEN'
          GROUP BY organization_id, symbol, account_key
        ) groups
          ON groups.organization_id = l.organization_id
         AND groups.symbol = l.symbol
         AND groups.account_key = l.account_key
        WHERE l.state = 'OPEN'
          AND (${organizationId}::uuid IS NULL OR l.organization_id = ${organizationId}::uuid)
          AND (
            ${parsed.query.mode}::text = 'all'
            OR EXISTS (
              SELECT 1
              FROM trader_trade_legs leg
              JOIN trader_orders o
                ON o.id = leg.order_id
               AND o.organization_id = leg.organization_id
              WHERE leg.position_lot_id = l.id
                AND leg.organization_id = l.organization_id
                AND ${orderVisibleInMode(parsed.query.mode, true)}
            )
          )
          AND (
            ${cursorTime}::timestamptz IS NULL
            OR l.opened_at < ${cursorTime}::timestamptz
            OR (l.opened_at = ${cursorTime}::timestamptz AND l.id::text < ${cursorId})
          )
        ORDER BY l.opened_at DESC, l.id::text DESC
        LIMIT ${limit + 1}
      `),
    );
    const page = rows.slice(0, limit);
    const lotIds = page.map((row) => String(row.id));
    const legRows =
      lotIds.length === 0
        ? []
        : rowsOf(
            await opened.runtime.db.execute(sql`
              SELECT leg.position_lot_id::text AS lot_id,
                     leg.id::text AS leg_id,
                     leg.organization_id::text AS organization_id,
                     leg.order_id::text AS order_id,
                     o.historical_run_id,
                     o.execution_mode,
                     o.credential_id::text AS credential_id,
                     o.strategy_signal_id,
                     o.symbol AS order_symbol,
                     c.id::text AS credential_row_id,
                     c.exchange_account_id
              FROM trader_trade_legs leg
              LEFT JOIN trader_orders o
                ON o.id = leg.order_id
               AND o.organization_id = leg.organization_id
              LEFT JOIN exchange_credentials c
                ON c.id = o.credential_id
               AND c.organization_id = o.organization_id
              WHERE leg.position_lot_id::text = ANY(string_to_array(${lotIds.join(",")}, ','))
            `),
          );
    const legsByLot = new Map<string, Record<string, unknown>[]>();
    for (const leg of legRows) {
      const lotId = String(leg.lot_id);
      const list = legsByLot.get(lotId) ?? [];
      list.push(leg);
      legsByLot.set(lotId, list);
    }
    const nowMs = Date.now();
    const items = page.map((row) => {
      const lotId = String(row.id);
      const organizationIdText = String(row.organization_id);
      const symbol = String(row.symbol);
      const accountKey = String(row.account_key);
      const legs = legsByLot.get(lotId) ?? [];
      const orders: AttributionOrder[] = [];
      const credentials: AttributionCredential[] = [];
      for (const leg of legs) {
        const orderId = text(leg.order_id);
        if (!orderId || !text(leg.execution_mode)) continue;
        orders.push({
          id: orderId,
          organizationId: organizationIdText,
          historicalRunId: text(leg.historical_run_id),
          executionMode: String(leg.execution_mode),
          credentialId: text(leg.credential_id),
          strategySignalId: text(leg.strategy_signal_id),
          symbol: text(leg.order_symbol) ?? symbol,
        });
        const credentialId = text(leg.credential_row_id);
        const exchangeAccountId = text(leg.exchange_account_id);
        if (credentialId && exchangeAccountId) {
          credentials.push({
            id: credentialId,
            organizationId: organizationIdText,
            exchangeAccountId,
          });
        }
      }
      const attribution = attributeLegs(
        legs.map((leg) => ({
          id: String(leg.leg_id),
          organizationId: organizationIdText,
          orderId: text(leg.order_id),
          strategySignalId: text(leg.strategy_signal_id),
          symbol,
          accountKey,
        })),
        orders,
        credentials,
      );
      const guardianAt = iso(row.guardian_at);
      const recommendation = text(row.recommendation);
      const openSufficiency = text(row.open_position_sufficiency);
      const newSufficiency = text(row.new_opportunity_sufficiency);
      const reduction = bps(row.target_reduction_bps);
      const guardian =
        guardianAt && recommendation && openSufficiency && newSufficiency && reduction !== null
          ? {
              recommendation,
              openPositionSufficiency: openSufficiency,
              newOpportunitySufficiency: newSufficiency,
              targetReductionBps: reduction,
              assessedAt: guardianAt,
            }
          : null;
      return presentOpenLot({
        lotId,
        organizationId: organizationIdText,
        symbol,
        accountKey,
        openQty: String(row.open_qty),
        remainingQty: String(row.remaining_qty),
        avgCost: String(row.avg_cost),
        openedAt: iso(row.opened_at) ?? "",
        exchangeAccountId:
          attribution.state === "attributed" ? attribution.exchangeAccountId : null,
        mode: attribution.state === "attributed" ? (attribution.mode as AdminMode) : null,
        attribution:
          attribution.state === "attributed"
            ? "attributed"
            : attribution.state === "ambiguous"
              ? "ambiguous"
              : "unattributed",
        openLotsInGroup: countOf(row.open_lot_count),
        guardian,
        riskPosture: text(row.risk_posture),
        nowMs,
      });
    });
    const last = items[items.length - 1];
    return adminSuccess(
      adminEnvelope({
        data: {
          items,
          total: null,
          nextCursor:
            rows.length > limit && last
              ? encodePageCursor({ t: last.openedAt, id: last.lotId })
              : null,
          truncated: rows.length > limit,
        },
        scope: adminScopeFromQuery(parsed.query),
        mode: parsed.query.mode,
      }),
      "postgres",
    );
  } finally {
    await deps.disposeRuntimeDb(opened.runtime);
  }
}
