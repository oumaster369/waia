import "server-only";

import { and, desc, eq } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
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

type PgReadExecutor = Pick<WaiaPostgresDb, "select">;
type PgWriteExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

function mapEvent(
  row: typeof pgSchema.traderMiTrialIntegrityEvent.$inferSelect,
): MiTrialIntegrityEvent {
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

export async function getLatestTrialIntegrityEventPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  trialId: string,
): Promise<MiTrialIntegrityEvent | null> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderMiTrialIntegrityEvent)
    .where(
      and(
        eq(pgSchema.traderMiTrialIntegrityEvent.trialId, trialId),
        orgScopedWhere(pgSchema.traderMiTrialIntegrityEvent.organizationId, scoped),
      ),
    )
    .orderBy(desc(pgSchema.traderMiTrialIntegrityEvent.seq))
    .limit(1);

  return rows[0] ? mapEvent(rows[0]) : null;
}

export async function listTrialIntegrityEventsPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  trialId: string,
): Promise<MiTrialIntegrityEvent[]> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderMiTrialIntegrityEvent)
    .where(
      and(
        eq(pgSchema.traderMiTrialIntegrityEvent.trialId, trialId),
        orgScopedWhere(pgSchema.traderMiTrialIntegrityEvent.organizationId, scoped),
      ),
    )
    .orderBy(pgSchema.traderMiTrialIntegrityEvent.seq);

  return rows.map(mapEvent);
}

export async function insertTrialIntegrityEventPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  row: InsertTrialIntegrityEventRow,
): Promise<MiTrialIntegrityEvent> {
  const scoped = requireOrgContext(context.organizationId);

  await ex.insert(pgSchema.traderMiTrialIntegrityEvent).values({
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
  });

  const rows = await ex
    .select()
    .from(pgSchema.traderMiTrialIntegrityEvent)
    .where(
      and(
        eq(pgSchema.traderMiTrialIntegrityEvent.id, row.id),
        orgScopedWhere(pgSchema.traderMiTrialIntegrityEvent.organizationId, scoped),
      ),
    )
    .limit(1);

  if (!rows[0]) {
    throw new Error("[trader] mi trial integrity event insert failed");
  }
  return mapEvent(rows[0]);
}
