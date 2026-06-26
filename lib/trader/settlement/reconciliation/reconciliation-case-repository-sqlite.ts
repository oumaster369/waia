import { and, asc, eq, inArray, lt, or } from "drizzle-orm";

import * as sqliteSchema from "@/db/schema";
import type { WaiaDb } from "@/db/types";
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

type SqliteReadExecutor = { select: WaiaDb["select"] };
type SqliteExecutor = Pick<WaiaDb, "select" | "insert" | "update">;

function mapCaseRow(
  row: typeof sqliteSchema.traderSettlementReconciliationCases.$inferSelect,
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
  row: typeof sqliteSchema.traderSettlementReconciliationEvents.$inferSelect,
): ReconciliationEventRecordView {
  const payload = JSON.parse(row.payload) as ReconciliationEventRecordView["payload"];
  const view: ReconciliationEventRecordView = {
    id: row.id,
    schemaVersion: row.schemaVersion as ReconciliationEventRecordView["schemaVersion"],
    organizationId: row.organizationId,
    caseId: row.caseId,
    seq: row.seq,
    eventType: row.eventType,
    actorType: row.actorType,
    actorId: row.actorId,
    payload,
    prevEventDigest: row.prevEventDigest,
    recordContentDigest: row.recordContentDigest,
    createdAt: row.createdAt,
  };
  verifyReconciliationEventDigest(view);
  return view;
}

export async function findReconciliationCaseByIdSqlite(
  ex: SqliteReadExecutor,
  context: OrgContext,
  caseId: string,
): Promise<ReconciliationCaseView | null> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(sqliteSchema.traderSettlementReconciliationCases)
    .where(
      and(
        orgScopedWhere(sqliteSchema.traderSettlementReconciliationCases.organizationId, scoped),
        eq(sqliteSchema.traderSettlementReconciliationCases.id, caseId),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row ? mapCaseRow(row) : null;
}

export async function findReconciliationCaseBySettlementIdSqlite(
  ex: SqliteReadExecutor,
  context: OrgContext,
  settlementId: string,
): Promise<ReconciliationCaseView | null> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(sqliteSchema.traderSettlementReconciliationCases)
    .where(
      and(
        orgScopedWhere(sqliteSchema.traderSettlementReconciliationCases.organizationId, scoped),
        eq(sqliteSchema.traderSettlementReconciliationCases.settlementId, settlementId),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row ? mapCaseRow(row) : null;
}

export async function openReconciliationCaseSqlite(
  ex: SqliteExecutor,
  context: OrgContext,
  input: OpenReconciliationCaseInput,
): Promise<{ case: ReconciliationCaseView; event: ReconciliationEventRecordView }> {
  const scoped = requireOrgContext(context.organizationId);
  verifyReconciliationEventDigest(input.event);
  const eventId = crypto.randomUUID();
  const now = input.openedAt;

  await ex.insert(sqliteSchema.traderSettlementReconciliationCases).values({
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

  await ex.insert(sqliteSchema.traderSettlementReconciliationEvents).values({
    id: eventId,
    caseId: input.caseId,
    organizationId: scoped.organizationId,
    seq: input.event.seq,
    eventType: input.event.eventType,
    actorType: input.event.actorType,
    actorId: input.event.actorId,
    payload: JSON.stringify(input.event.payload),
    schemaVersion: input.event.schemaVersion,
    recordContentDigest: input.event.recordContentDigest,
    prevEventDigest: input.event.prevEventDigest,
    createdAt: now,
  });

  const caseRows = await ex
    .select()
    .from(sqliteSchema.traderSettlementReconciliationCases)
    .where(eq(sqliteSchema.traderSettlementReconciliationCases.id, input.caseId))
    .limit(1);
  const eventRows = await ex
    .select()
    .from(sqliteSchema.traderSettlementReconciliationEvents)
    .where(eq(sqliteSchema.traderSettlementReconciliationEvents.id, eventId))
    .limit(1);

  const caseRow = caseRows[0];
  const eventRow = eventRows[0];
  if (!caseRow || !eventRow) {
    throw new Error("[trader/settlement/reconciliation] open case insert failed");
  }
  return { case: mapCaseRow(caseRow), event: mapEventRow(eventRow) };
}

export async function appendReconciliationEventSqlite(
  ex: SqliteExecutor,
  context: OrgContext,
  input: AppendReconciliationEventInput,
): Promise<{ case: ReconciliationCaseView; event: ReconciliationEventRecordView }> {
  const scoped = requireOrgContext(context.organizationId);
  verifyReconciliationEventDigest(input.event);

  const existing = await findReconciliationCaseByIdSqlite(ex, scoped, input.caseId);
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

  await ex.insert(sqliteSchema.traderSettlementReconciliationEvents).values({
    id: eventId,
    caseId: input.caseId,
    organizationId: scoped.organizationId,
    seq: input.event.seq,
    eventType: input.event.eventType,
    actorType: input.event.actorType,
    actorId: input.event.actorId,
    payload: JSON.stringify(input.event.payload),
    schemaVersion: input.event.schemaVersion,
    recordContentDigest: input.event.recordContentDigest,
    prevEventDigest: input.event.prevEventDigest,
    createdAt: now,
  });

  await ex
    .update(sqliteSchema.traderSettlementReconciliationCases)
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
        eq(sqliteSchema.traderSettlementReconciliationCases.id, input.caseId),
        eq(
          sqliteSchema.traderSettlementReconciliationCases.lastEventSeq,
          input.expectedLastEventSeq,
        ),
      ),
    );

  const caseRows = await ex
    .select()
    .from(sqliteSchema.traderSettlementReconciliationCases)
    .where(eq(sqliteSchema.traderSettlementReconciliationCases.id, input.caseId))
    .limit(1);
  const eventRows = await ex
    .select()
    .from(sqliteSchema.traderSettlementReconciliationEvents)
    .where(eq(sqliteSchema.traderSettlementReconciliationEvents.id, eventId))
    .limit(1);

  const caseRow = caseRows[0];
  const eventRow = eventRows[0];
  if (!caseRow || !eventRow) {
    throw new Error("[trader/settlement/reconciliation] append event failed");
  }
  if (caseRow.lastEventSeq !== input.projection.lastEventSeq) {
    throw new ReconciliationStaleConcurrencyTokenError(
      input.caseId,
      input.expectedLastEventSeq,
      caseRow.lastEventSeq,
    );
  }
  return { case: mapCaseRow(caseRow), event: mapEventRow(eventRow) };
}

export async function listReconciliationEventsForCaseSqlite(
  ex: SqliteReadExecutor,
  context: OrgContext,
  caseId: string,
): Promise<ReconciliationEventRecordView[]> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(sqliteSchema.traderSettlementReconciliationEvents)
    .where(
      and(
        orgScopedWhere(sqliteSchema.traderSettlementReconciliationEvents.organizationId, scoped),
        eq(sqliteSchema.traderSettlementReconciliationEvents.caseId, caseId),
      ),
    )
    .orderBy(asc(sqliteSchema.traderSettlementReconciliationEvents.seq));
  return rows.map(mapEventRow);
}

export async function listClaimExpiredReconciliationCasesSqlite(
  ex: SqliteReadExecutor,
  context: OrgContext,
  now: Date,
): Promise<ReconciliationCaseView[]> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(sqliteSchema.traderSettlementReconciliationCases)
    .where(
      and(
        orgScopedWhere(sqliteSchema.traderSettlementReconciliationCases.organizationId, scoped),
        inArray(sqliteSchema.traderSettlementReconciliationCases.status, [
          "ASSIGNED",
          "UNDER_REVIEW",
        ]),
        lt(sqliteSchema.traderSettlementReconciliationCases.claimExpiresAt, now),
      ),
    );
  return rows.map(mapCaseRow);
}

export function createSqliteReconciliationCaseRepository(
  ex: SqliteExecutor,
): ReconciliationCaseRepository {
  return {
    findById: (context, caseId) => findReconciliationCaseByIdSqlite(ex, context, caseId),
    findBySettlementId: (context, settlementId) =>
      findReconciliationCaseBySettlementIdSqlite(ex, context, settlementId),
    openCase: (context, input) => openReconciliationCaseSqlite(ex, context, input),
    appendEvent: (context, input) => appendReconciliationEventSqlite(ex, context, input),
    listEventsForCase: (context, caseId) =>
      listReconciliationEventsForCaseSqlite(ex, context, caseId),
    listClaimExpired: (context, now) => listClaimExpiredReconciliationCasesSqlite(ex, context, now),
  };
}
