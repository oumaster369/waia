import { sql, type SQL } from "drizzle-orm";

import {
  adminSuccess,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import {
  attributeLegs,
  type Attribution,
  type AttributionCredential,
  type AttributionLeg,
  type AttributionOrder,
} from "@/lib/trader/admin-console/attribution/trade-attribution";
import { adminEnvelope } from "@/lib/trader/admin-console/data-state";
import { openAdminConsole } from "@/lib/trader/admin-console/handlers/guard";
import { ADMIN_REASON } from "@/lib/trader/admin-console/reason-codes";
import {
  positionMatchesMode,
  presentOpenPosition,
  type PositionGuardianAssessment,
} from "@/lib/trader/admin-console/read-models/positions";
import { adminScopeFromQuery, parseAdminConsoleQuery } from "@/lib/trader/admin-console/scope";

function rowsOf(result: unknown): Record<string, unknown>[] {
  return Array.isArray(result) ? (result as Record<string, unknown>[]) : [];
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function iso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "string" || value.length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function uuidList(ids: readonly string[]): SQL {
  return sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
}

type LotRow = {
  id: string;
  organizationId: string;
  symbol: string;
  venue: string;
  accountKey: string;
  positionSide: string;
  strategySignalId: string;
  openQty: string;
  remainingQty: string;
  avgCost: string;
  openedAt: string | null;
  guardian: PositionGuardianAssessment | null;
};

export async function handleAdminConsolePositionsGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const parsed = parseAdminConsoleQuery(new URL(request.url));
  if (!parsed.ok) return parsed.result;
  const opened = await openAdminConsole(request, deps);
  if (!opened.ok) return opened.result;
  const organizationId = parsed.query.organization_id ?? null;
  const now = new Date();
  try {
    const rows = rowsOf(
      await opened.runtime.db.execute(sql`
        SELECT l.id::text AS id,
               l.organization_id::text AS organization_id,
               l.symbol,
               l.venue,
               l.account_key,
               l.position_side,
               l.strategy_signal_id,
               l.open_qty,
               l.remaining_qty,
               l.avg_cost,
               l.opened_at,
               g.assessment_id,
               g.created_at AS guardian_at,
               g.recommendation,
               g.open_position_sufficiency,
               g.new_opportunity_sufficiency
        FROM trader_position_lots l
        LEFT JOIN (
          SELECT DISTINCT ON (organization_id, lot_id)
                 organization_id,
                 lot_id,
                 assessment_id,
                 created_at,
                 recommendation,
                 open_position_sufficiency,
                 new_opportunity_sufficiency
          FROM trader_guardian_assessments_v2
          ORDER BY organization_id, lot_id, created_at DESC, assessment_id DESC
        ) g ON g.lot_id = l.id AND g.organization_id = l.organization_id
        WHERE l.state = 'OPEN'
          AND (${organizationId}::uuid IS NULL OR l.organization_id = ${organizationId}::uuid)
        ORDER BY l.opened_at DESC, l.id DESC
        LIMIT ${parsed.query.limit}
      `),
    );
    const lots: LotRow[] = rows.map((row) => {
      const assessedAt = iso(row.guardian_at);
      const assessmentId = text(row.assessment_id);
      return {
        id: String(row.id),
        organizationId: String(row.organization_id),
        symbol: String(row.symbol),
        venue: String(row.venue),
        accountKey: String(row.account_key),
        positionSide: String(row.position_side),
        strategySignalId: String(row.strategy_signal_id),
        openQty: String(row.open_qty),
        remainingQty: String(row.remaining_qty),
        avgCost: String(row.avg_cost),
        openedAt: iso(row.opened_at),
        guardian:
          assessmentId && assessedAt
            ? {
                assessmentId,
                assessedAt,
                recommendation: String(row.recommendation),
                openPositionSufficiency: String(row.open_position_sufficiency),
                newOpportunitySufficiency: String(row.new_opportunity_sufficiency),
              }
            : null,
      };
    });
    const attributionByLot = await attributionsForLots(opened.runtime.db, lots);
    const items = [];
    for (const lot of lots) {
      const attribution = attributionByLot.get(lot.id) ?? {
        state: "unattributed" as const,
        reason: ADMIN_REASON.unattributed,
      };
      if (!positionMatchesMode(parsed.query.mode, attribution)) continue;
      items.push(presentOpenPosition({ ...lot, attribution, now }));
    }
    return adminSuccess(
      adminEnvelope({
        data: { items },
        scope: adminScopeFromQuery(parsed.query),
        mode: parsed.query.mode,
      }),
      "postgres",
    );
  } finally {
    await deps.disposeRuntimeDb(opened.runtime);
  }
}

async function attributionsForLots(
  db: { execute: (query: SQL) => Promise<unknown> },
  lots: readonly LotRow[],
): Promise<Map<string, Attribution>> {
  const byLot = new Map<string, Attribution>();
  if (lots.length === 0) return byLot;
  const lotById = new Map(lots.map((lot) => [lot.id, lot]));
  const legs = rowsOf(
    await db.execute(sql`
      SELECT position_lot_id::text AS lot_id,
             id::text AS id,
             organization_id::text AS organization_id,
             order_id::text AS order_id
      FROM trader_trade_legs
      WHERE position_lot_id IN (${uuidList(lots.map((lot) => lot.id))})
    `),
  );
  const orderIds = [...new Set(legs.map((leg) => text(leg.order_id)).filter((id) => id != null))];
  const orders =
    orderIds.length === 0
      ? []
      : rowsOf(
          await db.execute(sql`
            SELECT id::text AS id,
                   organization_id::text AS organization_id,
                   historical_run_id,
                   execution_mode,
                   credential_id::text AS credential_id,
                   strategy_signal_id,
                   symbol
            FROM trader_orders
            WHERE id IN (${uuidList(orderIds)})
          `),
        );
  const credentialIds = [
    ...new Set(orders.map((order) => text(order.credential_id)).filter((id) => id != null)),
  ];
  const credentials =
    credentialIds.length === 0
      ? []
      : rowsOf(
          await db.execute(sql`
            SELECT id::text AS id,
                   organization_id::text AS organization_id,
                   exchange_account_id
            FROM exchange_credentials
            WHERE id IN (${uuidList(credentialIds)})
          `),
        );
  const attributionOrders: AttributionOrder[] = orders.map((order) => ({
    id: String(order.id),
    organizationId: String(order.organization_id),
    historicalRunId: text(order.historical_run_id),
    executionMode: String(order.execution_mode),
    credentialId: text(order.credential_id),
    strategySignalId: text(order.strategy_signal_id),
    symbol: String(order.symbol),
  }));
  const attributionCredentials: AttributionCredential[] = credentials.map((credential) => ({
    id: String(credential.id),
    organizationId: String(credential.organization_id),
    exchangeAccountId: String(credential.exchange_account_id),
  }));
  const legsByLot = new Map<string, AttributionLeg[]>();
  for (const leg of legs) {
    const lotId = String(leg.lot_id);
    const lot = lotById.get(lotId);
    const current = legsByLot.get(lotId) ?? [];
    current.push({
      id: String(leg.id),
      organizationId: String(leg.organization_id),
      orderId: text(leg.order_id),
      strategySignalId: lot?.strategySignalId ?? null,
      symbol: lot?.symbol ?? "",
      accountKey: lot?.accountKey ?? null,
    });
    legsByLot.set(lotId, current);
  }
  for (const lot of lots) {
    byLot.set(
      lot.id,
      attributeLegs(legsByLot.get(lot.id) ?? [], attributionOrders, attributionCredentials),
    );
  }
  return byLot;
}
