import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import { and, desc, eq } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import { traderReportingPeriods } from "@/db/schema";
import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import {
  adminSuccess,
  authorizeAdminRoute,
  parseOrganizationId,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";

export type ClosedReportingPeriodRow = {
  id: string;
  organizationId: string;
  exchangeAccountId: string;
  status: "CLOSED";
  periodStart: string;
  periodEnd: string | null;
  realizedPnl: string | null;
  unrealizedPnl: string | null;
  startingEquity: string;
  endingEquity: string | null;
};

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function present(row: {
  id: string;
  organizationId: string;
  exchangeAccountId: string;
  periodStart: Date;
  periodEnd: Date | null;
  realizedPnl: string | null;
  unrealizedPnl: string | null;
  startingEquity: string;
  endingEquity: string | null;
}): ClosedReportingPeriodRow {
  return {
    id: row.id,
    organizationId: row.organizationId,
    exchangeAccountId: row.exchangeAccountId,
    status: "CLOSED",
    periodStart: row.periodStart.toISOString(),
    periodEnd: iso(row.periodEnd),
    realizedPnl: row.realizedPnl,
    unrealizedPnl: row.unrealizedPnl,
    startingEquity: row.startingEquity,
    endingEquity: row.endingEquity,
  };
}

export function listClosedReportingPeriodsSqlite(
  db: WaiaDb,
  organizationId: string,
  exchangeAccountId: string | null,
): ClosedReportingPeriodRow[] {
  const where = exchangeAccountId
    ? and(
        eq(traderReportingPeriods.organizationId, organizationId),
        eq(traderReportingPeriods.exchangeAccountId, exchangeAccountId),
        eq(traderReportingPeriods.status, "CLOSED"),
      )
    : and(
        eq(traderReportingPeriods.organizationId, organizationId),
        eq(traderReportingPeriods.status, "CLOSED"),
      );
  return db
    .select({
      id: traderReportingPeriods.id,
      organizationId: traderReportingPeriods.organizationId,
      exchangeAccountId: traderReportingPeriods.exchangeAccountId,
      periodStart: traderReportingPeriods.periodStart,
      periodEnd: traderReportingPeriods.periodEnd,
      realizedPnl: traderReportingPeriods.realizedPnl,
      unrealizedPnl: traderReportingPeriods.unrealizedPnl,
      startingEquity: traderReportingPeriods.startingEquity,
      endingEquity: traderReportingPeriods.endingEquity,
    })
    .from(traderReportingPeriods)
    .where(where)
    .orderBy(desc(traderReportingPeriods.periodStart))
    .limit(200)
    .all()
    .map(present);
}

export async function listClosedReportingPeriodsPostgres(
  db: WaiaPostgresDb,
  organizationId: string,
  exchangeAccountId: string | null,
): Promise<ClosedReportingPeriodRow[]> {
  const where = exchangeAccountId
    ? and(
        eq(pgSchema.traderReportingPeriods.organizationId, organizationId),
        eq(pgSchema.traderReportingPeriods.exchangeAccountId, exchangeAccountId),
        eq(pgSchema.traderReportingPeriods.status, "CLOSED"),
      )
    : and(
        eq(pgSchema.traderReportingPeriods.organizationId, organizationId),
        eq(pgSchema.traderReportingPeriods.status, "CLOSED"),
      );
  const rows = await db
    .select({
      id: pgSchema.traderReportingPeriods.id,
      organizationId: pgSchema.traderReportingPeriods.organizationId,
      exchangeAccountId: pgSchema.traderReportingPeriods.exchangeAccountId,
      periodStart: pgSchema.traderReportingPeriods.periodStart,
      periodEnd: pgSchema.traderReportingPeriods.periodEnd,
      realizedPnl: pgSchema.traderReportingPeriods.realizedPnl,
      unrealizedPnl: pgSchema.traderReportingPeriods.unrealizedPnl,
      startingEquity: pgSchema.traderReportingPeriods.startingEquity,
      endingEquity: pgSchema.traderReportingPeriods.endingEquity,
    })
    .from(pgSchema.traderReportingPeriods)
    .where(where)
    .orderBy(desc(pgSchema.traderReportingPeriods.periodStart))
    .limit(200);
  return rows.map(present);
}

export async function handleAdminReportingPeriodsGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const url = new URL(request.url);
  const orgParsed = parseOrganizationId(url);
  if (typeof orgParsed !== "string") return orgParsed;
  const exchangeAccountId = url.searchParams.get("exchange_account_id")?.trim() || null;
  let runtime;
  try {
    const auth = await authorizeAdminRoute(deps, orgParsed, "admin.audit.read");
    if (!auth.ok) return auth.result;
    runtime = auth.runtime;
    const reportingPeriods =
      runtime.kind === "sqlite"
        ? listClosedReportingPeriodsSqlite(runtime.db, orgParsed, exchangeAccountId)
        : await listClosedReportingPeriodsPostgres(runtime.db, orgParsed, exchangeAccountId);
    return adminSuccess({ reportingPeriods }, runtime.kind);
  } finally {
    await deps.disposeRuntimeDb(runtime);
  }
}
