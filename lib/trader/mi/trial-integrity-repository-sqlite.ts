import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, desc, eq } from "drizzle-orm";

import { traderMiTrialIntegrityEvent } from "@/db/schema";
import type { WaiaDb } from "@/db/types";
import type { MiTrialIntegrityEvent } from "@/lib/trader/mi/trial-integrity.types";
import {
  isMiTrialIntegrityEventType,
  isMiTrialIntegrityReasonCode,
  MI_TRIAL_INTEGRITY_SCHEMA_VERSION,
} from "@/lib/trader/mi/trial-integrity.types";
import type { InsertTrialIntegrityEventRow } from "@/lib/trader/mi/types";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

function mapEvent(row: typeof traderMiTrialIntegrityEvent.$inferSelect): MiTrialIntegrityEvent {
  if (!isMiTrialIntegrityEventType(row.eventType)) {
    throw new Error(`[trader] unknown mi trial integrity event_type: ${row.eventType}`);
  }
  if (row.reasonCode !== null && !isMiTrialIntegrityReasonCode(row.reasonCode)) {
    throw new Error(`[trader] unknown mi trial integrity reason_code: ${row.reasonCode}`);
  }

  return {
    id: row.id,
    organizationId: row.organizationId,
    trialId: row.trialId,
    eventType: row.eventType,
    reasonCode: row.reasonCode,
    rationale: row.rationale,
    causeRef: row.causeRef,
    schemaVersion: MI_TRIAL_INTEGRITY_SCHEMA_VERSION,
    eventTime: row.eventTime,
    ingestTime: row.ingestTime,
    recordedBy: row.recordedBy,
    seq: row.seq,
    contentDigest: row.contentDigest,
    createdAt: row.createdAt,
  };
}

export function getLatestTrialIntegrityEventSqlite(
  db: WaiaDb,
  context: OrgContext,
  trialId: string,
): MiTrialIntegrityEvent | null {
  const scoped = requireOrgContext(context.organizationId);
  const row = db
    .select()
    .from(traderMiTrialIntegrityEvent)
    .where(
      and(
        eq(traderMiTrialIntegrityEvent.trialId, trialId),
        orgScopedWhere(traderMiTrialIntegrityEvent.organizationId, scoped),
      ),
    )
    .orderBy(desc(traderMiTrialIntegrityEvent.seq))
    .limit(1)
    .all()[0];

  return row ? mapEvent(row) : null;
}

export function listTrialIntegrityEventsSqlite(
  db: WaiaDb,
  context: OrgContext,
  trialId: string,
): MiTrialIntegrityEvent[] {
  const scoped = requireOrgContext(context.organizationId);
  return db
    .select()
    .from(traderMiTrialIntegrityEvent)
    .where(
      and(
        eq(traderMiTrialIntegrityEvent.trialId, trialId),
        orgScopedWhere(traderMiTrialIntegrityEvent.organizationId, scoped),
      ),
    )
    .orderBy(traderMiTrialIntegrityEvent.seq)
    .all()
    .map(mapEvent);
}

export function insertTrialIntegrityEventSqlite(
  db: WaiaDb,
  context: OrgContext,
  row: InsertTrialIntegrityEventRow,
): MiTrialIntegrityEvent {
  const scoped = requireOrgContext(context.organizationId);

  db.insert(traderMiTrialIntegrityEvent)
    .values({
      id: row.id,
      organizationId: scoped.organizationId,
      trialId: row.trialId,
      eventType: row.eventType,
      reasonCode: row.reasonCode,
      rationale: row.rationale,
      causeRef: row.causeRef,
      schemaVersion: row.schemaVersion,
      eventTime: row.eventTime,
      ingestTime: row.ingestTime,
      recordedBy: row.recordedBy,
      seq: row.seq,
      contentDigest: row.contentDigest,
      createdAt: row.createdAt,
    })
    .run();

  const inserted = db
    .select()
    .from(traderMiTrialIntegrityEvent)
    .where(
      and(
        eq(traderMiTrialIntegrityEvent.id, row.id),
        orgScopedWhere(traderMiTrialIntegrityEvent.organizationId, scoped),
      ),
    )
    .limit(1)
    .all()[0];

  if (!inserted) {
    throw new Error("[trader] mi trial integrity event insert failed");
  }
  return mapEvent(inserted);
}
