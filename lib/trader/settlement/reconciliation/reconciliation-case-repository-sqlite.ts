import { and, asc, eq } from "drizzle-orm";

import * as sqliteSchema from "@/db/schema";
import type { WaiaDb } from "@/db/types";
import type {
  OpenReconciliationCaseInput,
  ReconciliationCaseRepository,
} from "@/lib/trader/settlement/reconciliation/reconciliation-case-repository.types";
import { verifyReconciliationEventDigest } from "@/lib/trader/settlement/reconciliation/serialize-reconciliation";
import type {
  ReconciliationCaseView,
  ReconciliationEventRecordView,
} from "@/lib/trader/settlement/reconciliation/reconciliation.types";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type SqliteReadExecutor = { select: WaiaDb["select"] };
type SqliteExecutor = Pick<WaiaDb, "select" | "insert">;

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
    resolutionType: row.resolutionType,
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

export function createSqliteReconciliationCaseRepository(
  ex: SqliteExecutor,
): ReconciliationCaseRepository {
  return {
    findBySettlementId: (context, settlementId) =>
      findReconciliationCaseBySettlementIdSqlite(ex, context, settlementId),
    openCase: (context, input) => openReconciliationCaseSqlite(ex, context, input),
    listEventsForCase: (context, caseId) =>
      listReconciliationEventsForCaseSqlite(ex, context, caseId),
  };
}
