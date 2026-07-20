import "server-only";

import { and, asc, eq } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
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

type PgExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update">;

function mapDisputeRow(
  row: typeof pgSchema.traderInvoiceDisputes.$inferSelect,
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
  row: typeof pgSchema.traderInvoiceDisputeEvents.$inferSelect,
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

export async function findOpenInvoiceDisputeByInvoiceIdPostgres(
  ex: PgExecutor,
  context: OrgContext,
  invoiceId: string,
): Promise<InvoiceDisputeProjectionView | null> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderInvoiceDisputes)
    .where(
      and(
        orgScopedWhere(pgSchema.traderInvoiceDisputes.organizationId, scoped),
        eq(pgSchema.traderInvoiceDisputes.invoiceId, invoiceId),
        eq(pgSchema.traderInvoiceDisputes.status, "OPEN"),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row ? mapDisputeRow(row) : null;
}

export async function getInvoiceDisputeByIdPostgres(
  ex: PgExecutor,
  context: OrgContext,
  disputeId: string,
): Promise<InvoiceDisputeProjectionView | null> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderInvoiceDisputes)
    .where(
      and(
        eq(pgSchema.traderInvoiceDisputes.id, disputeId),
        orgScopedWhere(pgSchema.traderInvoiceDisputes.organizationId, scoped),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row ? mapDisputeRow(row) : null;
}

export async function listInvoiceDisputeEventsPostgres(
  ex: PgExecutor,
  context: OrgContext,
  disputeId: string,
): Promise<InvoiceDisputeEventRecordView[]> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderInvoiceDisputeEvents)
    .where(
      and(
        orgScopedWhere(pgSchema.traderInvoiceDisputeEvents.organizationId, scoped),
        eq(pgSchema.traderInvoiceDisputeEvents.disputeId, disputeId),
      ),
    )
    .orderBy(asc(pgSchema.traderInvoiceDisputeEvents.seq));
  return rows.map(mapDisputeEventRow);
}

export async function appendInvoiceDisputeEventAndProjectionPostgres(
  ex: PgExecutor,
  context: OrgContext,
  payload: InvoiceDisputeEventRecordPayload,
  projection: InvoiceDisputeProjectionView,
): Promise<InvoiceDisputeEventRecordView> {
  const scoped = requireOrgContext(context.organizationId);
  verifyInvoiceDisputeEventDigest(payload);
  const id = crypto.randomUUID();
  const now = new Date();

  const existing = await getInvoiceDisputeByIdPostgres(ex, context, projection.id);
  if (existing) {
    await ex
      .update(pgSchema.traderInvoiceDisputes)
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
          eq(pgSchema.traderInvoiceDisputes.id, projection.id),
          orgScopedWhere(pgSchema.traderInvoiceDisputes.organizationId, scoped),
        ),
      );
  } else {
    await ex.insert(pgSchema.traderInvoiceDisputes).values({
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
    });
  }

  await ex.insert(pgSchema.traderInvoiceDisputeEvents).values({
    id,
    organizationId: scoped.organizationId,
    disputeId: payload.disputeId,
    seq: payload.seq,
    eventType: payload.eventType,
    reason: payload.reason,
    actorType:
      payload.actorType as typeof pgSchema.traderInvoiceDisputeEvents.$inferInsert.actorType,
    actorId: payload.actorId,
    schemaVersion: payload.schemaVersion,
    recordContentDigest: payload.recordContentDigest,
    prevEventDigest: payload.prevEventDigest,
    createdAt: now,
  });

  const rows = await ex
    .select()
    .from(pgSchema.traderInvoiceDisputeEvents)
    .where(eq(pgSchema.traderInvoiceDisputeEvents.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error("[trader/billing] invoice dispute event insert failed");
  }
  return mapDisputeEventRow(row);
}

export async function listOpenDisputeInvoiceIdsPostgres(
  ex: PgExecutor,
  context: OrgContext,
): Promise<string[]> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select({ invoiceId: pgSchema.traderInvoiceDisputes.invoiceId })
    .from(pgSchema.traderInvoiceDisputes)
    .where(
      and(
        orgScopedWhere(pgSchema.traderInvoiceDisputes.organizationId, scoped),
        eq(pgSchema.traderInvoiceDisputes.status, "OPEN"),
      ),
    );
  return rows.map((row) => row.invoiceId);
}

export function createPostgresInvoiceDisputeRepository(ex: PgExecutor): InvoiceDisputeRepository {
  return {
    findOpenByInvoiceId(context, invoiceId) {
      return findOpenInvoiceDisputeByInvoiceIdPostgres(ex, context, invoiceId);
    },
    getById(context, disputeId) {
      return getInvoiceDisputeByIdPostgres(ex, context, disputeId);
    },
    listEventsForDispute(context, disputeId) {
      return listInvoiceDisputeEventsPostgres(ex, context, disputeId);
    },
    appendEventAndProjection(context, payload, projection) {
      return appendInvoiceDisputeEventAndProjectionPostgres(ex, context, payload, projection);
    },
    listOpenDisputeInvoiceIds(context) {
      return listOpenDisputeInvoiceIdsPostgres(ex, context);
    },
  };
}
