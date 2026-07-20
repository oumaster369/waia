import "server-only";

import { and, asc, eq } from "drizzle-orm";

import * as sqliteSchema from "@/db/schema";
import type { WaiaDb } from "@/db/types";
import type { InvoiceDisputeRepository } from "@/lib/trader/billing/governance/dispute-repository.types";
import type {
  InvoiceDisputeEventRecordPayload,
  InvoiceDisputeEventRecordView,
  InvoiceDisputeProjectionView,
} from "@/lib/trader/billing/governance/billing-governance.types";
import { verifyInvoiceDisputeEventDigest } from "@/lib/trader/billing/governance/serialize-invoice-dispute-event";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type SqliteDb = Pick<WaiaDb, "select" | "insert" | "update">;

function mapDisputeRow(
  row: typeof sqliteSchema.traderInvoiceDisputes.$inferSelect,
): InvoiceDisputeProjectionView {
  return {
    id: row.id,
    organizationId: row.organizationId,
    invoiceId: row.invoiceId,
    exchangeAccountId: row.exchangeAccountId,
    status: row.status,
    reason: row.reason,
    openedBy: row.openedBy,
    openedAt: row.openedAt,
    resolvedAt: row.resolvedAt,
    resolutionReason: row.resolutionReason,
    lastEventSeq: row.lastEventSeq,
    lastEventDigest: row.lastEventDigest,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapDisputeEventRow(
  row: typeof sqliteSchema.traderInvoiceDisputeEvents.$inferSelect,
): InvoiceDisputeEventRecordView {
  const view: InvoiceDisputeEventRecordView = {
    id: row.id,
    schemaVersion: row.schemaVersion as InvoiceDisputeEventRecordView["schemaVersion"],
    organizationId: row.organizationId,
    disputeId: row.disputeId,
    seq: row.seq,
    eventType: row.eventType,
    reason: row.reason,
    actorType: row.actorType,
    actorId: row.actorId,
    prevEventDigest: row.prevEventDigest,
    recordContentDigest: row.recordContentDigest,
    createdAt: row.createdAt,
  };
  verifyInvoiceDisputeEventDigest(view);
  return view;
}

export function findOpenInvoiceDisputeByInvoiceIdSqlite(
  db: SqliteDb,
  context: OrgContext,
  invoiceId: string,
): InvoiceDisputeProjectionView | null {
  const scoped = requireOrgContext(context.organizationId);
  const row = db
    .select()
    .from(sqliteSchema.traderInvoiceDisputes)
    .where(
      and(
        orgScopedWhere(sqliteSchema.traderInvoiceDisputes.organizationId, scoped),
        eq(sqliteSchema.traderInvoiceDisputes.invoiceId, invoiceId),
        eq(sqliteSchema.traderInvoiceDisputes.status, "OPEN"),
      ),
    )
    .get();
  return row ? mapDisputeRow(row) : null;
}

export function getInvoiceDisputeByIdSqlite(
  db: SqliteDb,
  context: OrgContext,
  disputeId: string,
): InvoiceDisputeProjectionView | null {
  const scoped = requireOrgContext(context.organizationId);
  const row = db
    .select()
    .from(sqliteSchema.traderInvoiceDisputes)
    .where(
      and(
        eq(sqliteSchema.traderInvoiceDisputes.id, disputeId),
        orgScopedWhere(sqliteSchema.traderInvoiceDisputes.organizationId, scoped),
      ),
    )
    .get();
  return row ? mapDisputeRow(row) : null;
}

export function listInvoiceDisputeEventsSqlite(
  db: SqliteDb,
  context: OrgContext,
  disputeId: string,
): InvoiceDisputeEventRecordView[] {
  const scoped = requireOrgContext(context.organizationId);
  const rows = db
    .select()
    .from(sqliteSchema.traderInvoiceDisputeEvents)
    .where(
      and(
        orgScopedWhere(sqliteSchema.traderInvoiceDisputeEvents.organizationId, scoped),
        eq(sqliteSchema.traderInvoiceDisputeEvents.disputeId, disputeId),
      ),
    )
    .orderBy(asc(sqliteSchema.traderInvoiceDisputeEvents.seq))
    .all();
  return rows.map(mapDisputeEventRow);
}

export function appendInvoiceDisputeEventAndProjectionSqlite(
  db: SqliteDb,
  context: OrgContext,
  payload: InvoiceDisputeEventRecordPayload,
  projection: InvoiceDisputeProjectionView,
): InvoiceDisputeEventRecordView {
  const scoped = requireOrgContext(context.organizationId);
  verifyInvoiceDisputeEventDigest(payload);
  const id = crypto.randomUUID();
  const now = new Date();

  const existing = getInvoiceDisputeByIdSqlite(db, context, projection.id);
  if (existing) {
    db.update(sqliteSchema.traderInvoiceDisputes)
      .set({
        status: projection.status,
        reason: projection.reason,
        resolvedAt: projection.resolvedAt,
        resolutionReason: projection.resolutionReason,
        lastEventSeq: projection.lastEventSeq,
        lastEventDigest: projection.lastEventDigest,
        updatedAt: now,
      })
      .where(
        and(
          eq(sqliteSchema.traderInvoiceDisputes.id, projection.id),
          orgScopedWhere(sqliteSchema.traderInvoiceDisputes.organizationId, scoped),
        ),
      )
      .run();
  } else {
    db.insert(sqliteSchema.traderInvoiceDisputes)
      .values({
        id: projection.id,
        organizationId: scoped.organizationId,
        invoiceId: projection.invoiceId,
        exchangeAccountId: projection.exchangeAccountId,
        status: projection.status,
        reason: projection.reason,
        openedBy: projection.openedBy,
        openedAt: projection.openedAt,
        resolvedAt: projection.resolvedAt,
        resolutionReason: projection.resolutionReason,
        lastEventSeq: projection.lastEventSeq,
        lastEventDigest: projection.lastEventDigest,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  db.insert(sqliteSchema.traderInvoiceDisputeEvents)
    .values({
      id,
      organizationId: scoped.organizationId,
      disputeId: payload.disputeId,
      seq: payload.seq,
      eventType: payload.eventType,
      reason: payload.reason,
      actorType:
        payload.actorType as typeof sqliteSchema.traderInvoiceDisputeEvents.$inferInsert.actorType,
      actorId: payload.actorId,
      schemaVersion: payload.schemaVersion,
      recordContentDigest: payload.recordContentDigest,
      prevEventDigest: payload.prevEventDigest,
      createdAt: now,
    })
    .run();

  const row = db
    .select()
    .from(sqliteSchema.traderInvoiceDisputeEvents)
    .where(eq(sqliteSchema.traderInvoiceDisputeEvents.id, id))
    .get();
  if (!row) {
    throw new Error("[trader/billing] invoice dispute event insert failed");
  }
  return mapDisputeEventRow(row);
}

export function listOpenDisputeInvoiceIdsSqlite(db: SqliteDb, context: OrgContext): string[] {
  const scoped = requireOrgContext(context.organizationId);
  const rows = db
    .select({ invoiceId: sqliteSchema.traderInvoiceDisputes.invoiceId })
    .from(sqliteSchema.traderInvoiceDisputes)
    .where(
      and(
        orgScopedWhere(sqliteSchema.traderInvoiceDisputes.organizationId, scoped),
        eq(sqliteSchema.traderInvoiceDisputes.status, "OPEN"),
      ),
    )
    .all();
  return rows.map((row) => row.invoiceId);
}

export function createSqliteInvoiceDisputeRepository(db: SqliteDb): InvoiceDisputeRepository {
  return {
    findOpenByInvoiceId(context, invoiceId) {
      return Promise.resolve(findOpenInvoiceDisputeByInvoiceIdSqlite(db, context, invoiceId));
    },
    getById(context, disputeId) {
      return Promise.resolve(getInvoiceDisputeByIdSqlite(db, context, disputeId));
    },
    listEventsForDispute(context, disputeId) {
      return Promise.resolve(listInvoiceDisputeEventsSqlite(db, context, disputeId));
    },
    appendEventAndProjection(context, payload, projection) {
      return Promise.resolve(
        appendInvoiceDisputeEventAndProjectionSqlite(db, context, payload, projection),
      );
    },
    listOpenDisputeInvoiceIds(context) {
      return Promise.resolve(listOpenDisputeInvoiceIdsSqlite(db, context));
    },
  };
}
