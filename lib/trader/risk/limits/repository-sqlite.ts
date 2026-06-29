import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, eq } from "drizzle-orm";

import { traderRiskLimits } from "@/db/schema";
import type { WaiaDb } from "@/db/types";
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

function mapRow(row: typeof traderRiskLimits.$inferSelect): RiskLimitsRow {
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
    orgScopedWhere(traderRiskLimits.organizationId, scoped),
    eq(traderRiskLimits.scopeType, scope.scopeType),
    eq(traderRiskLimits.scopeRef, scopeRefToDb(scope)),
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

export function getLimitsRowForScopeSqlite(
  db: WaiaDb,
  context: OrgContext,
  scope: OrgRiskLimitsScope,
): RiskLimitsRow | null {
  const scoped = requireOrgContext(context.organizationId);
  const row = db
    .select()
    .from(traderRiskLimits)
    .where(scopeConditions(scoped, scope))
    .limit(1)
    .all()[0];

  return row ? mapRow(row) : null;
}

export function insertLimitsRowForScopeSqlite(
  db: WaiaDb,
  context: OrgContext,
  scope: OrgRiskLimitsScope,
  input: UpsertRiskLimitsRowInput,
): RiskLimitsRow {
  const scoped = requireOrgContext(context.organizationId);
  const id = crypto.randomUUID();
  const now = new Date();

  db.insert(traderRiskLimits)
    .values({
      id,
      organizationId: scoped.organizationId,
      scopeType: scope.scopeType,
      scopeRef: scopeRefToDb(scope),
      ...rowValuesFromInput(input),
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const row = getLimitsRowForScopeSqlite(db, scoped, scope);
  if (!row) {
    throw new Error("[trader] risk limits insert failed");
  }
  return row;
}

export function updateLimitsRowForScopeSqlite(
  db: WaiaDb,
  context: OrgContext,
  scope: OrgRiskLimitsScope,
  rowId: string,
  input: UpsertRiskLimitsRowInput,
): RiskLimitsRow | null {
  const scoped = requireOrgContext(context.organizationId);
  const existing = getLimitsRowForScopeSqlite(db, scoped, scope);
  if (!existing || existing.id !== rowId) {
    return null;
  }

  const now = new Date();
  db.update(traderRiskLimits)
    .set({
      ...rowValuesFromInput(input),
      updatedAt: now,
    })
    .where(
      and(eq(traderRiskLimits.id, rowId), orgScopedWhere(traderRiskLimits.organizationId, scoped)),
    )
    .run();

  return getLimitsRowForScopeSqlite(db, scoped, scope);
}
