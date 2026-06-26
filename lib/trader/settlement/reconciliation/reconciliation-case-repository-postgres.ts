import "server-only";

import { and, eq, inArray, lt } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { ReconciliationStaleConcurrencyTokenError } from "@/lib/trader/settlement/reconciliation/reconciliation.errors";
import type {
  AppendReconciliationEventInput,
  OpenReconciliationCaseInput,
  ReconciliationCaseRepository,
} from "@/lib/trader/settlement/reconciliation/reconciliation-case-repository.types";
import { verifyReconciliationEventDigest } from "@/lib/trader/settlement/reconciliation/serialize-reconciliation";
import type {
  ReconciliationCaseView,
  ReconciliationEventRecordView,
  ReconciliationResolutionType,
} from "@/lib/trader/settlement/reconciliation/reconciliation.types";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgReadExecutor = { select: WaiaPostgresDb["select"] };
type PgExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update">;

function mapCaseRow(
  row: typeof pgSchema.traderSettlementReconciliationCases.$inferSelect,
): ReconciliationCaseView {
  return {
    id: row.id,
    organizationId: row.organizationId,
    settlementId: row.settlementId,
    paymentId: row.paymentId,
    exchangeAccountId: row.exchangeAccountId,
    exceptionReason: row.exceptionReason,
    status: row.status,
    priority: row.priority,
    resolutionType: row.resolutionType as ReconciliationResolutionType | null,
    currentDecisionId: row.currentDecisionId ?? null,
    assignedTo: row.assignedTo,
    claimExpiresAt: row.claimExpiresAt,
    coolingOffUntil: row.coolingOffUntil,
    openedAt: row.openedAt,
    resolvedAt: row.resolvedAt,
    lastEventSeq: row.lastEventSeq,
    lastEventDigest: row.lastEventDigest,
  };
}

function mapEventRow(
  row: typeof pgSchema.traderSettlementReconciliationEvents.$inferSelect,
): ReconciliationEventRecordView {
  const view: ReconciliationEventRecordView = {
    id: row.id,
    schemaVersion: row.schemaVersion as ReconciliationEventRecordView["schemaVersion"],
    organizationId: row.organizationId,
    caseId: row.caseId,
    seq: row.seq,
    eventType: row.eventType,
    actorType: row.actorType,
    actorId: row.actorId,
    payload: row.payload as ReconciliationEventRecordView["payload"],
    prevEventDigest: row.prevEventDigest,
    recordContentDigest: row.recordContentDigest,
    createdAt: row.createdAt,
  };
  verifyReconciliationEventDigest(view);
  return view;
}

export async function findReconciliationCaseByIdPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  caseId: string,
): Promise<ReconciliationCaseView | null> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderSettlementReconciliationCases)
    .where(
      and(
        orgScopedWhere(pgSchema.traderSettlementReconciliationCases.organizationId, scoped),
        eq(pgSchema.traderSettlementReconciliationCases.id, caseId),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row ? mapCaseRow(row) : null;
}

export async function findReconciliationCaseBySettlementIdPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  settlementId: string,
): Promise<ReconciliationCaseView | null> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderSettlementReconciliationCases)
    .where(
      and(
        orgScopedWhere(pgSchema.traderSettlementReconciliationCases.organizationId, scoped),
        eq(pgSchema.traderSettlementReconciliationCases.settlementId, settlementId),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row ? mapCaseRow(row) : null;
}

export async function openReconciliationCasePostgres(
  ex: PgExecutor,
  context: OrgContext,
  input: OpenReconciliationCaseInput,
): Promise<{ case: ReconciliationCaseView; event: ReconciliationEventRecordView }> {
  const scoped = requireOrgContext(context.organizationId);
  verifyReconciliationEventDigest(input.event);
  const eventId = crypto.randomUUID();
  const now = input.openedAt;

  await ex.insert(pgSchema.traderSettlementReconciliationCases).values({
    id: input.caseId,
    organizationId: scoped.organizationId,
    settlementId: input.settlementId,
    paymentId: input.paymentId,
    exchangeAccountId: input.exchangeAccountId,
    exceptionReason: input.exceptionReason,
    status: "OPEN",
    priority: input.priority,
    resolutionType: null,
    currentDecisionId: null,
    assignedTo: null,
    claimExpiresAt: null,
    coolingOffUntil: null,
    openedAt: now,
    resolvedAt: null,
    lastEventSeq: input.event.seq,
    lastEventDigest: input.event.recordContentDigest,
  });

  await ex.insert(pgSchema.traderSettlementReconciliationEvents).values({
    id: eventId,
    caseId: input.caseId,
    organizationId: scoped.organizationId,
    seq: input.event.seq,
    eventType: input.event.eventType,
    actorType: input.event.actorType,
    actorId: input.event.actorId,
    payload: input.event.payload,
    schemaVersion: input.event.schemaVersion,
    recordContentDigest: input.event.recordContentDigest,
    prevEventDigest: input.event.prevEventDigest,
    createdAt: now,
  });

  const caseRows = await ex
    .select()
    .from(pgSchema.traderSettlementReconciliationCases)
    .where(eq(pgSchema.traderSettlementReconciliationCases.id, input.caseId))
    .limit(1);
  const eventRows = await ex
    .select()
    .from(pgSchema.traderSettlementReconciliationEvents)
    .where(eq(pgSchema.traderSettlementReconciliationEvents.id, eventId))
    .limit(1);

  const caseRow = caseRows[0];
  const eventRow = eventRows[0];
  if (!caseRow || !eventRow) {
    throw new Error("[trader/settlement/reconciliation] open case insert failed");
  }
  return { case: mapCaseRow(caseRow), event: mapEventRow(eventRow) };
}

export async function appendReconciliationEventPostgres(
  ex: PgExecutor,
  context: OrgContext,
  input: AppendReconciliationEventInput,
): Promise<{ case: ReconciliationCaseView; event: ReconciliationEventRecordView }> {
  const scoped = requireOrgContext(context.organizationId);
  verifyReconciliationEventDigest(input.event);

  const existing = await findReconciliationCaseByIdPostgres(ex, scoped, input.caseId);
  if (!existing) {
    throw new Error(`[trader/settlement/reconciliation] case not found: ${input.caseId}`);
  }
  if (existing.lastEventSeq !== input.expectedLastEventSeq) {
    throw new ReconciliationStaleConcurrencyTokenError(
      input.caseId,
      input.expectedLastEventSeq,
      existing.lastEventSeq,
    );
  }

  const eventId = crypto.randomUUID();
  const now = new Date();

  await ex.insert(pgSchema.traderSettlementReconciliationEvents).values({
    id: eventId,
    caseId: input.caseId,
    organizationId: scoped.organizationId,
    seq: input.event.seq,
    eventType: input.event.eventType,
    actorType: input.event.actorType,
    actorId: input.event.actorId,
    payload: input.event.payload,
    schemaVersion: input.event.schemaVersion,
    recordContentDigest: input.event.recordContentDigest,
    prevEventDigest: input.event.prevEventDigest,
    createdAt: now,
  });

  const updated = await ex
    .update(pgSchema.traderSettlementReconciliationCases)
    .set({
      status: input.projection.status,
      assignedTo: input.projection.assignedTo,
      claimExpiresAt: input.projection.claimExpiresAt,
      coolingOffUntil: input.projection.coolingOffUntil,
      resolutionType: input.projection.resolutionType,
      currentDecisionId: input.projection.currentDecisionId,
      resolvedAt: input.projection.resolvedAt,
      lastEventSeq: input.projection.lastEventSeq,
      lastEventDigest: input.projection.lastEventDigest,
    })
    .where(
      and(
        eq(pgSchema.traderSettlementReconciliationCases.id, input.caseId),
        eq(pgSchema.traderSettlementReconciliationCases.lastEventSeq, input.expectedLastEventSeq),
      ),
    )
    .returning();

  const caseRow = updated[0];
  const eventRows = await ex
    .select()
    .from(pgSchema.traderSettlementReconciliationEvents)
    .where(eq(pgSchema.traderSettlementReconciliationEvents.id, eventId))
    .limit(1);

  const eventRow = eventRows[0];
  if (!caseRow || !eventRow) {
    throw new ReconciliationStaleConcurrencyTokenError(
      input.caseId,
      input.expectedLastEventSeq,
      caseRow?.lastEventSeq ?? -1,
    );
  }
  return { case: mapCaseRow(caseRow), event: mapEventRow(eventRow) };
}

export async function listReconciliationEventsForCasePostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  caseId: string,
): Promise<ReconciliationEventRecordView[]> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderSettlementReconciliationEvents)
    .where(
      and(
        orgScopedWhere(pgSchema.traderSettlementReconciliationEvents.organizationId, scoped),
        eq(pgSchema.traderSettlementReconciliationEvents.caseId, caseId),
      ),
    )
    .orderBy(pgSchema.traderSettlementReconciliationEvents.seq);
  return rows.map(mapEventRow);
}

export async function listClaimExpiredReconciliationCasesPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  now: Date,
): Promise<ReconciliationCaseView[]> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderSettlementReconciliationCases)
    .where(
      and(
        orgScopedWhere(pgSchema.traderSettlementReconciliationCases.organizationId, scoped),
        inArray(pgSchema.traderSettlementReconciliationCases.status, ["ASSIGNED", "UNDER_REVIEW"]),
        lt(pgSchema.traderSettlementReconciliationCases.claimExpiresAt, now),
      ),
    );
  return rows.map(mapCaseRow);
}

export function createPostgresReconciliationCaseRepository(
  ex: PgExecutor,
): ReconciliationCaseRepository {
  return {
    findById: (context, caseId) => findReconciliationCaseByIdPostgres(ex, context, caseId),
    findBySettlementId: (context, settlementId) =>
      findReconciliationCaseBySettlementIdPostgres(ex, context, settlementId),
    openCase: (context, input) => openReconciliationCasePostgres(ex, context, input),
    appendEvent: (context, input) => appendReconciliationEventPostgres(ex, context, input),
    listEventsForCase: (context, caseId) =>
      listReconciliationEventsForCasePostgres(ex, context, caseId),
    listClaimExpired: (context, now) =>
      listClaimExpiredReconciliationCasesPostgres(ex, context, now),
  };
}
