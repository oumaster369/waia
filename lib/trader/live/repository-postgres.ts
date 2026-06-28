import "server-only";

import { asc, eq } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { verifyOrgLiveEnableEventDigest } from "@/lib/trader/live/serialize-org-live-enable";
import type {
  OrgLiveEnableEventRecordPayload,
  OrgLiveEnableEventView,
  OrgLiveEnableView,
} from "@/lib/trader/live/types";
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";

type PgExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update">;

function mapStateRow(row: typeof pgSchema.traderOrgLiveEnable.$inferSelect): OrgLiveEnableView {
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

function mapEventRow(
  row: typeof pgSchema.traderOrgLiveEnableEvents.$inferSelect,
): OrgLiveEnableEventView {
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

export async function getOrgLiveEnableStatePostgres(
  ex: PgExecutor,
  context: OrgContext,
): Promise<OrgLiveEnableView | null> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderOrgLiveEnable)
    .where(eq(pgSchema.traderOrgLiveEnable.organizationId, scoped.organizationId))
    .limit(1);
  const row = rows[0];
  return row ? mapStateRow(row) : null;
}

export async function listOrgLiveEnableEventsPostgres(
  ex: PgExecutor,
  context: OrgContext,
): Promise<OrgLiveEnableEventView[]> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderOrgLiveEnableEvents)
    .where(eq(pgSchema.traderOrgLiveEnableEvents.organizationId, scoped.organizationId))
    .orderBy(asc(pgSchema.traderOrgLiveEnableEvents.seq));
  return rows.map(mapEventRow);
}

export async function appendOrgLiveEnableEventAndProjectionPostgres(
  ex: PgExecutor,
  context: OrgContext,
  payload: OrgLiveEnableEventRecordPayload,
  projection: OrgLiveEnableView,
): Promise<OrgLiveEnableEventView> {
  const scoped = requireOrgContext(context.organizationId);
  verifyOrgLiveEnableEventDigest(payload);
  const id = crypto.randomUUID();
  const now = new Date();

  await ex.insert(pgSchema.traderOrgLiveEnableEvents).values({
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
  });

  const existing = await getOrgLiveEnableStatePostgres(ex, context);
  if (existing) {
    if (existing.stateVersion !== projection.stateVersion - 1) {
      throw new Error("ORG_LIVE_ENABLE_STATE_VERSION_MISMATCH");
    }
    await ex
      .update(pgSchema.traderOrgLiveEnable)
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
      .where(eq(pgSchema.traderOrgLiveEnable.organizationId, scoped.organizationId));
  } else {
    await ex.insert(pgSchema.traderOrgLiveEnable).values({
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
    });
  }

  const rows = await ex
    .select()
    .from(pgSchema.traderOrgLiveEnableEvents)
    .where(eq(pgSchema.traderOrgLiveEnableEvents.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error("[trader/live] org live-enable event insert failed");
  }
  return mapEventRow(row);
}
