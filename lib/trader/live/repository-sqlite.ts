import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { traderOrgLiveEnable, traderOrgLiveEnableEvents } from "@/db/schema";
import type { WaiaDb } from "@/db/types";
import { verifyOrgLiveEnableEventDigest } from "@/lib/trader/live/serialize-org-live-enable";
import type {
  OrgLiveEnableEventRecordPayload,
  OrgLiveEnableEventView,
  OrgLiveEnableView,
} from "@/lib/trader/live/types";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

function mapStateRow(row: typeof traderOrgLiveEnable.$inferSelect): OrgLiveEnableView {
  return {
    organizationId: row.organizationId,
    state: row.state,
    maxNotionalCap: row.maxNotionalCap,
    requestedAt: row.requestedAt,
    coolingOffEndsAt: row.coolingOffEndsAt,
    enabledAt: row.enabledAt,
    disabledAt: row.disabledAt,
    operatorAckPhraseHash: row.operatorAckPhraseHash,
    stateVersion: row.stateVersion,
    lastEventSeq: row.lastEventSeq,
    lastEventDigest: row.lastEventDigest,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapEventRow(row: typeof traderOrgLiveEnableEvents.$inferSelect): OrgLiveEnableEventView {
  return {
    id: row.id,
    organizationId: row.organizationId,
    seq: row.seq,
    eventType: row.eventType,
    maxNotionalCap: row.maxNotionalCap,
    reason: row.reason,
    actorType: row.actorType,
    actorId: row.actorId,
    schemaVersion: row.schemaVersion,
    recordContentDigest: row.recordContentDigest,
    prevEventDigest: row.prevEventDigest,
    createdAt: row.createdAt,
  };
}

export function getOrgLiveEnableStateSqlite(
  db: WaiaDb,
  context: OrgContext,
): OrgLiveEnableView | null {
  const scoped = requireOrgContext(context.organizationId);
  const row = db
    .select()
    .from(traderOrgLiveEnable)
    .where(orgScopedWhere(traderOrgLiveEnable.organizationId, scoped))
    .limit(1)
    .all()[0];
  return row ? mapStateRow(row) : null;
}

export function listOrgLiveEnableEventsSqlite(
  db: WaiaDb,
  context: OrgContext,
): OrgLiveEnableEventView[] {
  const scoped = requireOrgContext(context.organizationId);
  return db
    .select()
    .from(traderOrgLiveEnableEvents)
    .where(orgScopedWhere(traderOrgLiveEnableEvents.organizationId, scoped))
    .orderBy(asc(traderOrgLiveEnableEvents.seq))
    .all()
    .map(mapEventRow);
}

export function appendOrgLiveEnableEventAndProjectionSqlite(
  db: WaiaDb,
  context: OrgContext,
  payload: OrgLiveEnableEventRecordPayload,
  projection: OrgLiveEnableView,
): OrgLiveEnableEventView {
  const scoped = requireOrgContext(context.organizationId);
  verifyOrgLiveEnableEventDigest(payload);
  const id = crypto.randomUUID();
  const now = new Date();

  db.insert(traderOrgLiveEnableEvents)
    .values({
      id,
      organizationId: scoped.organizationId,
      seq: payload.seq,
      eventType: payload.eventType,
      maxNotionalCap: payload.maxNotionalCap,
      reason: payload.reason,
      actorType: payload.actorType,
      actorId: payload.actorId,
      schemaVersion: payload.schemaVersion,
      recordContentDigest: payload.recordContentDigest,
      prevEventDigest: payload.prevEventDigest,
      createdAt: now,
    })
    .run();

  const existing = getOrgLiveEnableStateSqlite(db, context);
  if (existing) {
    const updated = db
      .update(traderOrgLiveEnable)
      .set({
        state: projection.state,
        maxNotionalCap: projection.maxNotionalCap,
        requestedAt: projection.requestedAt,
        coolingOffEndsAt: projection.coolingOffEndsAt,
        enabledAt: projection.enabledAt,
        disabledAt: projection.disabledAt,
        operatorAckPhraseHash: projection.operatorAckPhraseHash,
        stateVersion: projection.stateVersion,
        lastEventSeq: projection.lastEventSeq,
        lastEventDigest: projection.lastEventDigest,
        updatedAt: now,
      })
      .where(
        and(
          orgScopedWhere(traderOrgLiveEnable.organizationId, scoped),
          eq(traderOrgLiveEnable.stateVersion, existing.stateVersion),
        ),
      )
      .run();
    if (updated.changes !== 1) {
      throw new Error("ORG_LIVE_ENABLE_STATE_VERSION_MISMATCH");
    }
  } else {
    db.insert(traderOrgLiveEnable)
      .values({
        organizationId: scoped.organizationId,
        state: projection.state,
        maxNotionalCap: projection.maxNotionalCap,
        requestedAt: projection.requestedAt,
        coolingOffEndsAt: projection.coolingOffEndsAt,
        enabledAt: projection.enabledAt,
        disabledAt: projection.disabledAt,
        operatorAckPhraseHash: projection.operatorAckPhraseHash,
        stateVersion: projection.stateVersion,
        lastEventSeq: projection.lastEventSeq,
        lastEventDigest: projection.lastEventDigest,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  const row = db
    .select()
    .from(traderOrgLiveEnableEvents)
    .where(eq(traderOrgLiveEnableEvents.id, id))
    .limit(1)
    .all()[0];
  if (!row) {
    throw new Error("[trader/live] org live-enable event insert failed");
  }
  return mapEventRow(row);
}
