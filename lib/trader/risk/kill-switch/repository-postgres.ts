import "server-only";

import { and, eq, inArray, isNull, or } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
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

type PgReadExecutor = Pick<WaiaPostgresDb, "select">;
type PgWriteExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update">;

function mapRow(row: typeof pgSchema.traderKillSwitches.$inferSelect): KillSwitchRow {
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
    eq(pgSchema.traderKillSwitches.scopeType, key.scopeType),
    eq(pgSchema.traderKillSwitches.scopeRef, scopeRefToDb(key.scopeRef)),
    eq(pgSchema.traderKillSwitches.switchType, key.switchType),
  );
}

function targetConditions(target: KillSwitchTarget) {
  if (target.scopeType === "platform") {
    return and(
      eq(pgSchema.traderKillSwitches.scopeType, "platform"),
      isNull(pgSchema.traderKillSwitches.organizationId),
    );
  }

  const scoped = requireOrgContext(target.organizationId);
  return and(
    eq(pgSchema.traderKillSwitches.scopeType, "organization"),
    orgScopedWhere(pgSchema.traderKillSwitches.organizationId, scoped),
  );
}

function scopeKeyTargetConditions(target: KillSwitchTarget, key: KillSwitchScopeKey) {
  return and(targetConditions(target), keyConditions(key));
}

export async function getKillSwitchRowForScopePostgres(
  ex: PgReadExecutor,
  target: KillSwitchTarget,
  key: KillSwitchScopeKey,
): Promise<KillSwitchRow | null> {
  const rows = await ex
    .select()
    .from(pgSchema.traderKillSwitches)
    .where(scopeKeyTargetConditions(target, key))
    .limit(1);

  return rows[0] ? mapRow(rows[0]) : null;
}

export async function listKillSwitchRowsForOrgPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  filter?: KillSwitchListFilter,
): Promise<KillSwitchRow[]> {
  const scoped = requireOrgContext(context.organizationId);
  const conditions = [orgScopedWhere(pgSchema.traderKillSwitches.organizationId, scoped)];

  if (filter?.state) {
    conditions.push(eq(pgSchema.traderKillSwitches.state, filter.state));
  }
  if (filter?.switchType) {
    conditions.push(eq(pgSchema.traderKillSwitches.switchType, filter.switchType));
  }

  const rows = await ex
    .select()
    .from(pgSchema.traderKillSwitches)
    .where(and(...conditions));

  return rows.map(mapRow);
}

export async function listEnforcingKillSwitchRowsForResolutionPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
): Promise<KillSwitchRow[]> {
  const scoped = requireOrgContext(context.organizationId);

  const rows = await ex
    .select()
    .from(pgSchema.traderKillSwitches)
    .where(
      and(
        or(
          orgScopedWhere(pgSchema.traderKillSwitches.organizationId, scoped),
          isNull(pgSchema.traderKillSwitches.organizationId),
        ),
        inArray(pgSchema.traderKillSwitches.state, ["ACTIVE", "CLEARING"]),
      ),
    );

  return rows.map(mapRow);
}

export async function insertKillSwitchRowPostgres(
  ex: PgWriteExecutor,
  target: KillSwitchTarget,
  key: KillSwitchScopeKey,
  input: InsertKillSwitchRowInput,
): Promise<KillSwitchRow> {
  const id = crypto.randomUUID();
  const now = new Date();
  const organizationId =
    target.scopeType === "platform"
      ? null
      : requireOrgContext(target.organizationId).organizationId;

  await ex.insert(pgSchema.traderKillSwitches).values({
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
  });

  const row = await getKillSwitchRowForScopePostgres(ex, target, key);
  if (!row) {
    throw new Error("[trader] kill switch insert failed");
  }
  return row;
}

export async function updateKillSwitchRowWithVersionPostgres(
  ex: PgWriteExecutor,
  target: KillSwitchTarget,
  rowId: string,
  expectedStateVersion: number,
  patch: KillSwitchTransitionPatch,
): Promise<KillSwitchRow | null> {
  const existingRows = await ex
    .select()
    .from(pgSchema.traderKillSwitches)
    .where(and(eq(pgSchema.traderKillSwitches.id, rowId), targetConditions(target)))
    .limit(1);

  const existing = existingRows[0];
  if (!existing || existing.stateVersion !== expectedStateVersion) {
    return null;
  }

  const now = new Date();
  const updatedRows = await ex
    .update(pgSchema.traderKillSwitches)
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
        eq(pgSchema.traderKillSwitches.id, rowId),
        eq(pgSchema.traderKillSwitches.stateVersion, expectedStateVersion),
        targetConditions(target),
      ),
    )
    .returning();

  return updatedRows[0] ? mapRow(updatedRows[0]) : null;
}
