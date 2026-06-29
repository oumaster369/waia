import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, eq, inArray, isNull, or } from "drizzle-orm";

import { traderKillSwitches } from "@/db/schema";
import type { WaiaDb } from "@/db/types";
import type {
  InsertKillSwitchRowInput,
  KillSwitchListFilter,
  KillSwitchRow,
  KillSwitchScopeKey,
  KillSwitchTarget,
  KillSwitchTransitionPatch,
} from "@/lib/trader/risk/kill-switch/types";
import { scopeRefToDb } from "@/lib/trader/risk/kill-switch/types";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

function mapRow(row: typeof traderKillSwitches.$inferSelect): KillSwitchRow {
  return {
    id: row.id,
    organizationId: row.organizationId,
    scopeType: row.scopeType,
    scopeRef: row.scopeRef,
    switchType: row.switchType,
    enforcementMode: row.enforcementMode,
    state: row.state,
    origin: row.origin,
    reason: row.reason,
    clearingStartedAt: row.clearingStartedAt,
    coolingOffMs: row.coolingOffMs,
    trippedAt: row.trippedAt,
    clearedAt: row.clearedAt,
    stateVersion: row.stateVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function keyConditions(key: KillSwitchScopeKey) {
  return and(
    eq(traderKillSwitches.scopeType, key.scopeType),
    eq(traderKillSwitches.scopeRef, scopeRefToDb(key.scopeRef)),
    eq(traderKillSwitches.switchType, key.switchType),
  );
}

function targetConditions(target: KillSwitchTarget) {
  if (target.scopeType === "platform") {
    return and(
      eq(traderKillSwitches.scopeType, "platform"),
      isNull(traderKillSwitches.organizationId),
    );
  }

  const scoped = requireOrgContext(target.organizationId);
  return and(
    eq(traderKillSwitches.scopeType, "organization"),
    orgScopedWhere(traderKillSwitches.organizationId, scoped),
  );
}

function scopeKeyTargetConditions(target: KillSwitchTarget, key: KillSwitchScopeKey) {
  return and(targetConditions(target), keyConditions(key));
}

export function getKillSwitchRowForScopeSqlite(
  db: WaiaDb,
  target: KillSwitchTarget,
  key: KillSwitchScopeKey,
): KillSwitchRow | null {
  const row = db
    .select()
    .from(traderKillSwitches)
    .where(scopeKeyTargetConditions(target, key))
    .limit(1)
    .all()[0];

  return row ? mapRow(row) : null;
}

export function listKillSwitchRowsForOrgSqlite(
  db: WaiaDb,
  context: OrgContext,
  filter?: KillSwitchListFilter,
): KillSwitchRow[] {
  const scoped = requireOrgContext(context.organizationId);
  const conditions = [orgScopedWhere(traderKillSwitches.organizationId, scoped)];

  if (filter?.state) {
    conditions.push(eq(traderKillSwitches.state, filter.state));
  }
  if (filter?.switchType) {
    conditions.push(eq(traderKillSwitches.switchType, filter.switchType));
  }

  return db
    .select()
    .from(traderKillSwitches)
    .where(and(...conditions))
    .all()
    .map(mapRow);
}

export function listEnforcingKillSwitchRowsForResolutionSqlite(
  db: WaiaDb,
  context: OrgContext,
): KillSwitchRow[] {
  const scoped = requireOrgContext(context.organizationId);

  return db
    .select()
    .from(traderKillSwitches)
    .where(
      and(
        or(
          orgScopedWhere(traderKillSwitches.organizationId, scoped),
          isNull(traderKillSwitches.organizationId),
        ),
        inArray(traderKillSwitches.state, ["ACTIVE", "CLEARING"]),
      ),
    )
    .all()
    .map(mapRow);
}

export function insertKillSwitchRowSqlite(
  db: WaiaDb,
  target: KillSwitchTarget,
  key: KillSwitchScopeKey,
  input: InsertKillSwitchRowInput,
): KillSwitchRow {
  const id = crypto.randomUUID();
  const now = new Date();
  const organizationId =
    target.scopeType === "platform"
      ? null
      : requireOrgContext(target.organizationId).organizationId;

  db.insert(traderKillSwitches)
    .values({
      id,
      organizationId,
      scopeType: key.scopeType,
      scopeRef: scopeRefToDb(key.scopeRef),
      switchType: key.switchType,
      enforcementMode: input.enforcementMode,
      state: input.state,
      origin: input.origin,
      reason: input.reason,
      clearingStartedAt: input.clearingStartedAt ?? null,
      coolingOffMs: input.coolingOffMs ?? null,
      trippedAt: input.trippedAt ?? null,
      clearedAt: input.clearedAt ?? null,
      stateVersion: 1,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const row = getKillSwitchRowForScopeSqlite(db, target, key);
  if (!row) {
    throw new Error("[trader] kill switch insert failed");
  }
  return row;
}

export function updateKillSwitchRowWithVersionSqlite(
  db: WaiaDb,
  target: KillSwitchTarget,
  rowId: string,
  expectedStateVersion: number,
  patch: KillSwitchTransitionPatch,
): KillSwitchRow | null {
  const existing = db
    .select()
    .from(traderKillSwitches)
    .where(and(eq(traderKillSwitches.id, rowId), targetConditions(target)))
    .limit(1)
    .all()[0];

  if (!existing || existing.stateVersion !== expectedStateVersion) {
    return null;
  }

  const now = new Date();
  const result = db
    .update(traderKillSwitches)
    .set({
      state: patch.state,
      enforcementMode: patch.enforcementMode ?? existing.enforcementMode,
      origin: patch.origin ?? existing.origin,
      reason: patch.reason ?? existing.reason,
      clearingStartedAt:
        patch.clearingStartedAt !== undefined
          ? patch.clearingStartedAt
          : existing.clearingStartedAt,
      coolingOffMs: patch.coolingOffMs !== undefined ? patch.coolingOffMs : existing.coolingOffMs,
      trippedAt: patch.trippedAt !== undefined ? patch.trippedAt : existing.trippedAt,
      clearedAt: patch.clearedAt !== undefined ? patch.clearedAt : existing.clearedAt,
      stateVersion: existing.stateVersion + 1,
      updatedAt: now,
    })
    .where(
      and(
        eq(traderKillSwitches.id, rowId),
        eq(traderKillSwitches.stateVersion, expectedStateVersion),
        targetConditions(target),
      ),
    )
    .run();

  if (result.changes === 0) {
    return null;
  }

  const updated = db
    .select()
    .from(traderKillSwitches)
    .where(eq(traderKillSwitches.id, rowId))
    .limit(1)
    .all()[0];

  return updated ? mapRow(updated) : null;
}
