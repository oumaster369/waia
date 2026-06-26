import "server-only";

import { and, asc, eq } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type {
  AccountStatusRepository,
  InvoiceSettlementRepository,
} from "@/lib/trader/settlement/account-status-repository.types";
import { verifyAccountStatusEventDigest } from "@/lib/trader/settlement/serialize-settlement";
import type {
  AccountStatusEventRecordPayload,
  AccountStatusEventRecordView,
  AccountStatusProjectionView,
} from "@/lib/trader/settlement/settlement.types";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgReadExecutor = Pick<WaiaPostgresDb, "select">;
type PgWriteExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update">;

function mapAccountStatusRow(
  row: typeof pgSchema.traderAccountStatus.$inferSelect,
): AccountStatusProjectionView {
  return {
    organizationId: row.organizationId,
    exchangeAccountId: row.exchangeAccountId,
    status: row.status,
    reason: row.reason,
    lastEventSeq: row.lastEventSeq,
    lastEventDigest: row.lastEventDigest,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapAccountStatusEventRow(
  row: typeof pgSchema.traderAccountStatusEvents.$inferSelect,
): AccountStatusEventRecordView {
  const view: AccountStatusEventRecordView = {
    id: row.id,
    schemaVersion: row.schemaVersion as AccountStatusEventRecordView["schemaVersion"],
    organizationId: row.organizationId,
    exchangeAccountId: row.exchangeAccountId,
    seq: row.seq,
    eventType: row.eventType,
    reason: row.reason,
    sourcePaymentId: row.sourcePaymentId,
    sourceInvoiceId: row.sourceInvoiceId,
    prevEventDigest: row.prevEventDigest,
    recordContentDigest: row.recordContentDigest,
    createdAt: row.createdAt,
  };
  verifyAccountStatusEventDigest(view);
  return view;
}

export async function getAccountStatusProjectionPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  exchangeAccountId: string,
): Promise<AccountStatusProjectionView | null> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderAccountStatus)
    .where(
      and(
        orgScopedWhere(pgSchema.traderAccountStatus.organizationId, scoped),
        eq(pgSchema.traderAccountStatus.exchangeAccountId, exchangeAccountId),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row ? mapAccountStatusRow(row) : null;
}

export async function listAccountStatusEventsPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  exchangeAccountId: string,
): Promise<AccountStatusEventRecordView[]> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.traderAccountStatusEvents)
    .where(
      and(
        orgScopedWhere(pgSchema.traderAccountStatusEvents.organizationId, scoped),
        eq(pgSchema.traderAccountStatusEvents.exchangeAccountId, exchangeAccountId),
      ),
    )
    .orderBy(asc(pgSchema.traderAccountStatusEvents.seq));
  return rows.map(mapAccountStatusEventRow);
}

export async function appendAccountStatusEventAndProjectionPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  payload: AccountStatusEventRecordPayload,
  projection: AccountStatusProjectionView,
): Promise<AccountStatusEventRecordView> {
  const scoped = requireOrgContext(context.organizationId);
  verifyAccountStatusEventDigest(payload);
  const id = crypto.randomUUID();
  const now = new Date();

  await ex.insert(pgSchema.traderAccountStatusEvents).values({
    id,
    organizationId: scoped.organizationId,
    exchangeAccountId: payload.exchangeAccountId,
    seq: payload.seq,
    eventType: payload.eventType,
    reason: payload.reason,
    sourcePaymentId: payload.sourcePaymentId,
    sourceInvoiceId: payload.sourceInvoiceId,
    schemaVersion: payload.schemaVersion,
    recordContentDigest: payload.recordContentDigest,
    prevEventDigest: payload.prevEventDigest,
    createdAt: now,
  });

  await ex
    .insert(pgSchema.traderAccountStatus)
    .values({
      organizationId: scoped.organizationId,
      exchangeAccountId: projection.exchangeAccountId,
      status: projection.status,
      reason: projection.reason,
      lastEventSeq: projection.lastEventSeq,
      lastEventDigest: projection.lastEventDigest,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        pgSchema.traderAccountStatus.organizationId,
        pgSchema.traderAccountStatus.exchangeAccountId,
      ],
      set: {
        status: projection.status,
        reason: projection.reason,
        lastEventSeq: projection.lastEventSeq,
        lastEventDigest: projection.lastEventDigest,
        updatedAt: now,
      },
    });

  const rows = await ex
    .select()
    .from(pgSchema.traderAccountStatusEvents)
    .where(eq(pgSchema.traderAccountStatusEvents.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error("[trader/settlement] account status event insert failed");
  }
  return mapAccountStatusEventRow(row);
}

export async function listIssuedInvoicesForAccountPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  exchangeAccountId: string,
) {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select({
      id: pgSchema.traderInvoices.id,
      organizationId: pgSchema.traderInvoices.organizationId,
      exchangeAccountId: pgSchema.traderInvoices.exchangeAccountId,
      performanceFee: pgSchema.traderInvoices.performanceFee,
      status: pgSchema.traderInvoices.status,
      periodStart: pgSchema.traderInvoices.periodStart,
    })
    .from(pgSchema.traderInvoices)
    .where(
      and(
        orgScopedWhere(pgSchema.traderInvoices.organizationId, scoped),
        eq(pgSchema.traderInvoices.exchangeAccountId, exchangeAccountId),
        eq(pgSchema.traderInvoices.status, "ISSUED"),
      ),
    )
    .orderBy(asc(pgSchema.traderInvoices.periodStart));

  return rows;
}

export async function getInvoiceForSettlementLockPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  invoiceId: string,
) {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select({
      id: pgSchema.traderInvoices.id,
      organizationId: pgSchema.traderInvoices.organizationId,
      exchangeAccountId: pgSchema.traderInvoices.exchangeAccountId,
      performanceFee: pgSchema.traderInvoices.performanceFee,
      status: pgSchema.traderInvoices.status,
      periodStart: pgSchema.traderInvoices.periodStart,
      settledAmount: pgSchema.traderInvoices.settledAmount,
    })
    .from(pgSchema.traderInvoices)
    .where(
      and(
        eq(pgSchema.traderInvoices.id, invoiceId),
        orgScopedWhere(pgSchema.traderInvoices.organizationId, scoped),
      ),
    )
    .for("update")
    .limit(1);

  return rows[0] ?? null;
}

export async function markInvoicePaidPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  input: { invoiceId: string; settledAmount: string; paidAt: Date },
): Promise<void> {
  const scoped = requireOrgContext(context.organizationId);
  await ex
    .update(pgSchema.traderInvoices)
    .set({
      status: "PAID",
      settledAmount: input.settledAmount,
      paidAt: input.paidAt,
      updatedAt: input.paidAt,
    })
    .where(
      and(
        eq(pgSchema.traderInvoices.id, input.invoiceId),
        orgScopedWhere(pgSchema.traderInvoices.organizationId, scoped),
        eq(pgSchema.traderInvoices.status, "ISSUED"),
      ),
    );
}

export function createPostgresAccountStatusRepository(
  ex: PgWriteExecutor,
): AccountStatusRepository {
  return {
    getProjection(context, exchangeAccountId) {
      return getAccountStatusProjectionPostgres(ex, context, exchangeAccountId);
    },
    listEventsForAccount(context, exchangeAccountId) {
      return listAccountStatusEventsPostgres(ex, context, exchangeAccountId);
    },
    appendEventAndProjection(context, payload, projection) {
      return appendAccountStatusEventAndProjectionPostgres(ex, context, payload, projection);
    },
  };
}

export function createPostgresInvoiceSettlementRepository(
  ex: PgWriteExecutor,
): InvoiceSettlementRepository {
  return {
    listIssuedInvoicesForAccount(context, exchangeAccountId) {
      return listIssuedInvoicesForAccountPostgres(ex, context, exchangeAccountId);
    },
    getInvoiceForSettlementLock(context, invoiceId) {
      return getInvoiceForSettlementLockPostgres(ex, context, invoiceId);
    },
    markInvoicePaid(context, input) {
      return markInvoicePaidPostgres(ex, context, input);
    },
  };
}
