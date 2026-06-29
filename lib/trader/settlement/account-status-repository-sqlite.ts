import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, asc, eq } from "drizzle-orm";

import type { WaiaDb } from "@/db/types";
import * as sqliteSchema from "@/db/schema";
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

type SqliteDb = Pick<WaiaDb, "select" | "insert" | "update">;

function mapAccountStatusRow(
  row: typeof sqliteSchema.traderAccountStatus.$inferSelect,
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
  row: typeof sqliteSchema.traderAccountStatusEvents.$inferSelect,
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

export function getAccountStatusProjectionSqlite(
  db: SqliteDb,
  context: OrgContext,
  exchangeAccountId: string,
): AccountStatusProjectionView | null {
  const scoped = requireOrgContext(context.organizationId);
  const row = db
    .select()
    .from(sqliteSchema.traderAccountStatus)
    .where(
      and(
        orgScopedWhere(sqliteSchema.traderAccountStatus.organizationId, scoped),
        eq(sqliteSchema.traderAccountStatus.exchangeAccountId, exchangeAccountId),
      ),
    )
    .get();
  return row ? mapAccountStatusRow(row) : null;
}

export function listAccountStatusEventsSqlite(
  db: SqliteDb,
  context: OrgContext,
  exchangeAccountId: string,
): AccountStatusEventRecordView[] {
  const scoped = requireOrgContext(context.organizationId);
  const rows = db
    .select()
    .from(sqliteSchema.traderAccountStatusEvents)
    .where(
      and(
        orgScopedWhere(sqliteSchema.traderAccountStatusEvents.organizationId, scoped),
        eq(sqliteSchema.traderAccountStatusEvents.exchangeAccountId, exchangeAccountId),
      ),
    )
    .orderBy(asc(sqliteSchema.traderAccountStatusEvents.seq))
    .all();
  return rows.map(mapAccountStatusEventRow);
}

export function appendAccountStatusEventAndProjectionSqlite(
  db: SqliteDb,
  context: OrgContext,
  payload: AccountStatusEventRecordPayload,
  projection: AccountStatusProjectionView,
): AccountStatusEventRecordView {
  const scoped = requireOrgContext(context.organizationId);
  verifyAccountStatusEventDigest(payload);
  const id = crypto.randomUUID();
  const now = new Date();

  db.insert(sqliteSchema.traderAccountStatusEvents)
    .values({
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
    })
    .run();

  const existing = getAccountStatusProjectionSqlite(db, context, projection.exchangeAccountId);
  if (existing) {
    db.update(sqliteSchema.traderAccountStatus)
      .set({
        status: projection.status,
        reason: projection.reason,
        lastEventSeq: projection.lastEventSeq,
        lastEventDigest: projection.lastEventDigest,
        updatedAt: now,
      })
      .where(
        and(
          orgScopedWhere(sqliteSchema.traderAccountStatus.organizationId, scoped),
          eq(sqliteSchema.traderAccountStatus.exchangeAccountId, projection.exchangeAccountId),
        ),
      )
      .run();
  } else {
    db.insert(sqliteSchema.traderAccountStatus)
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
      .run();
  }

  const row = db
    .select()
    .from(sqliteSchema.traderAccountStatusEvents)
    .where(eq(sqliteSchema.traderAccountStatusEvents.id, id))
    .get();
  if (!row) {
    throw new Error("[trader/settlement] account status event insert failed");
  }
  return mapAccountStatusEventRow(row);
}

export function listIssuedInvoicesForAccountSqlite(
  db: SqliteDb,
  context: OrgContext,
  exchangeAccountId: string,
) {
  const scoped = requireOrgContext(context.organizationId);
  return db
    .select({
      id: sqliteSchema.traderInvoices.id,
      organizationId: sqliteSchema.traderInvoices.organizationId,
      exchangeAccountId: sqliteSchema.traderInvoices.exchangeAccountId,
      performanceFee: sqliteSchema.traderInvoices.performanceFee,
      status: sqliteSchema.traderInvoices.status,
      periodStart: sqliteSchema.traderInvoices.periodStart,
    })
    .from(sqliteSchema.traderInvoices)
    .where(
      and(
        orgScopedWhere(sqliteSchema.traderInvoices.organizationId, scoped),
        eq(sqliteSchema.traderInvoices.exchangeAccountId, exchangeAccountId),
        eq(sqliteSchema.traderInvoices.status, "ISSUED"),
      ),
    )
    .orderBy(asc(sqliteSchema.traderInvoices.periodStart))
    .all();
}

export function getInvoiceForSettlementLockSqlite(
  db: SqliteDb,
  context: OrgContext,
  invoiceId: string,
) {
  const scoped = requireOrgContext(context.organizationId);
  return (
    db
      .select({
        id: sqliteSchema.traderInvoices.id,
        organizationId: sqliteSchema.traderInvoices.organizationId,
        exchangeAccountId: sqliteSchema.traderInvoices.exchangeAccountId,
        performanceFee: sqliteSchema.traderInvoices.performanceFee,
        status: sqliteSchema.traderInvoices.status,
        periodStart: sqliteSchema.traderInvoices.periodStart,
        settledAmount: sqliteSchema.traderInvoices.settledAmount,
      })
      .from(sqliteSchema.traderInvoices)
      .where(
        and(
          eq(sqliteSchema.traderInvoices.id, invoiceId),
          orgScopedWhere(sqliteSchema.traderInvoices.organizationId, scoped),
        ),
      )
      .get() ?? null
  );
}

export function markInvoicePaidSqlite(
  db: SqliteDb,
  context: OrgContext,
  input: { invoiceId: string; settledAmount: string; paidAt: Date },
): void {
  const scoped = requireOrgContext(context.organizationId);
  db.update(sqliteSchema.traderInvoices)
    .set({
      status: "PAID",
      settledAmount: input.settledAmount,
      paidAt: input.paidAt,
      updatedAt: input.paidAt,
    })
    .where(
      and(
        eq(sqliteSchema.traderInvoices.id, input.invoiceId),
        orgScopedWhere(sqliteSchema.traderInvoices.organizationId, scoped),
        eq(sqliteSchema.traderInvoices.status, "ISSUED"),
      ),
    )
    .run();
}

export function createSqliteAccountStatusRepository(db: SqliteDb): AccountStatusRepository {
  return {
    getProjection(context, exchangeAccountId) {
      return Promise.resolve(getAccountStatusProjectionSqlite(db, context, exchangeAccountId));
    },
    listEventsForAccount(context, exchangeAccountId) {
      return Promise.resolve(listAccountStatusEventsSqlite(db, context, exchangeAccountId));
    },
    appendEventAndProjection(context, payload, projection) {
      return Promise.resolve(
        appendAccountStatusEventAndProjectionSqlite(db, context, payload, projection),
      );
    },
  };
}

export function createSqliteInvoiceSettlementRepository(db: SqliteDb): InvoiceSettlementRepository {
  return {
    listIssuedInvoicesForAccount(context, exchangeAccountId) {
      return Promise.resolve(listIssuedInvoicesForAccountSqlite(db, context, exchangeAccountId));
    },
    getInvoiceForSettlementLock(context, invoiceId) {
      return Promise.resolve(getInvoiceForSettlementLockSqlite(db, context, invoiceId));
    },
    markInvoicePaid(context, input) {
      markInvoicePaidSqlite(db, context, input);
      return Promise.resolve();
    },
  };
}
