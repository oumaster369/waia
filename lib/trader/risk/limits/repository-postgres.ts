import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, eq } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type {
  OrgRiskLimitsScope,
  RiskLimitsRow,
  UpsertRiskLimitsRowInput,
} from "@/lib/trader/risk/limits/types";
import { scopeRefToDb } from "@/lib/trader/risk/limits/types";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgReadExecutor = Pick<WaiaPostgresDb, "select">;
type PgWriteExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update">;

function mapRow(row: typeof pgSchema.traderRiskLimits.$inferSelect): RiskLimitsRow {
  return {
    id: row.id,
    organizationId: row.organizationId,
    scopeType: row.scopeType,
    scopeRef: row.scopeRef,
    allowedSymbolsJson: row.allowedSymbolsJson,
    maxNotional: row.maxNotional,
    maxOrdersPerWindow: row.maxOrdersPerWindow,
    windowMs: row.windowMs,
    collarBps: row.collarBps,
    maxPositionPerSymbol: row.maxPositionPerSymbol,
    maxDailyLoss: row.maxDailyLoss,
    maxDrawdown: row.maxDrawdown,
    maxOpenOrders: row.maxOpenOrders,
    maxQuoteExposure: row.maxQuoteExposure,
    configVersion: row.configVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function scopeConditions(scoped: OrgContext, scope: OrgRiskLimitsScope) {
  return and(
    orgScopedWhere(pgSchema.traderRiskLimits.organizationId, scoped),
    eq(pgSchema.traderRiskLimits.scopeType, scope.scopeType),
    eq(pgSchema.traderRiskLimits.scopeRef, scopeRefToDb(scope)),
  );
}

function rowValuesFromInput(input: UpsertRiskLimitsRowInput) {
  return {
    allowedSymbolsJson: JSON.stringify(input.allowedSymbols),
    maxNotional: input.maxNotional,
    maxOrdersPerWindow: input.maxOrdersPerWindow,
    windowMs: input.windowMs,
    collarBps: input.collarBps,
    maxPositionPerSymbol: input.maxPositionPerSymbol,
    maxDailyLoss: input.maxDailyLoss,
    maxDrawdown: input.maxDrawdown,
    maxOpenOrders: input.maxOpenOrders,
    maxQuoteExposure: input.maxQuoteExposure,
    configVersion: input.configVersion,
  };
}

export async function getLimitsRowForScopePostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  scope: OrgRiskLimitsScope,
): Promise<RiskLimitsRow | null> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderRiskLimits)
    .where(scopeConditions(scoped, scope))
    .limit(1);

  return rows[0] ? mapRow(rows[0]) : null;
}

export async function insertLimitsRowForScopePostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  scope: OrgRiskLimitsScope,
  input: UpsertRiskLimitsRowInput,
): Promise<RiskLimitsRow> {
  const scoped = requireOrgContext(context.organizationId);
  const id = crypto.randomUUID();
  const now = new Date();

  await ex.insert(pgSchema.traderRiskLimits).values({
    id,
    organizationId: scoped.organizationId,
    scopeType: scope.scopeType,
    scopeRef: scopeRefToDb(scope),
    ...rowValuesFromInput(input),
    createdAt: now,
    updatedAt: now,
  });

  const row = await getLimitsRowForScopePostgres(ex, scoped, scope);
  if (!row) {
    throw new Error("[trader] risk limits insert failed");
  }
  return row;
}

export async function updateLimitsRowForScopePostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  scope: OrgRiskLimitsScope,
  rowId: string,
  input: UpsertRiskLimitsRowInput,
): Promise<RiskLimitsRow | null> {
  const scoped = requireOrgContext(context.organizationId);
  const existing = await getLimitsRowForScopePostgres(ex, scoped, scope);
  if (!existing || existing.id !== rowId) {
    return null;
  }

  const now = new Date();
  await ex
    .update(pgSchema.traderRiskLimits)
    .set({
      ...rowValuesFromInput(input),
      updatedAt: now,
    })
    .where(
      and(
        eq(pgSchema.traderRiskLimits.id, rowId),
        orgScopedWhere(pgSchema.traderRiskLimits.organizationId, scoped),
      ),
    );

  return getLimitsRowForScopePostgres(ex, scoped, scope);
}
