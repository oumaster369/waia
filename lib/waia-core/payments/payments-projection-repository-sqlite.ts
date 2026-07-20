import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, desc, eq } from "drizzle-orm";

import { payments } from "@/db/schema";
import type { WaiaDb } from "@/db/types";
import { runSqliteTransaction } from "@/db/types";
import {
  mapPaymentProjectionRow,
  paymentProjectionToUpsertValues,
} from "@/lib/waia-core/payments/payments-projection-row-mapper";
import type { ListPaymentsQuery } from "@/lib/waia-core/payments/payments-projection-repository.types";
import {
  DEFAULT_PAYMENTS_LIST_LIMIT,
  MAX_PAYMENTS_LIST_LIMIT,
} from "@/lib/waia-core/payments/payments-projection-repository.types";
import type { PaymentProjectionView } from "@/lib/waia-core/payments/payment-projection.types";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

function resolveListLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_PAYMENTS_LIST_LIMIT;
  }
  const normalized = Math.trunc(limit);
  if (normalized <= 0) {
    return DEFAULT_PAYMENTS_LIST_LIMIT;
  }
  return Math.min(normalized, MAX_PAYMENTS_LIST_LIMIT);
}

function mapSelectRow(row: typeof payments.$inferSelect): PaymentProjectionView {
  return mapPaymentProjectionRow(row);
}

export function upsertPaymentProjectionSqlite(
  db: WaiaDb,
  context: OrgContext,
  projection: PaymentProjectionView,
): PaymentProjectionView {
  const scoped = requireOrgContext(context.organizationId);
  const now = new Date();

  db.insert(payments)
    .values(paymentProjectionToUpsertValues(projection, now))
    .onConflictDoUpdate({
      target: payments.paymentId,
      set: {
        status: projection.status,
        direction: projection.direction,
        subjectModule: projection.subjectModule,
        subjectInvoiceId: projection.subjectInvoiceId,
        settlementAmount: projection.settlementAmount,
        settlementAsset: projection.settlementAsset,
        settlementNetwork: projection.settlementNetwork,
        settlementTxHash: projection.settlementTxHash,
        transferIndex: projection.transferIndex,
        valuedAmountUsd: projection.valuedAmountUsd,
        valuationSource: projection.valuationSource,
        lastEventSeq: projection.lastEventSeq,
        lastEventDigest: projection.lastEventDigest,
        updatedAt: now,
      },
    })
    .run();

  const row = db
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.paymentId, projection.paymentId),
        orgScopedWhere(payments.organizationId, scoped),
      ),
    )
    .limit(1)
    .all()[0];

  if (!row) {
    throw new Error("[waia-core] payment projection upsert failed");
  }
  return mapSelectRow(row);
}

export function getPaymentProjectionByIdSqlite(
  db: WaiaDb,
  context: OrgContext,
  paymentId: string,
): PaymentProjectionView | null {
  const scoped = requireOrgContext(context.organizationId);

  const row = db
    .select()
    .from(payments)
    .where(and(eq(payments.paymentId, paymentId), orgScopedWhere(payments.organizationId, scoped)))
    .limit(1)
    .all()[0];

  return row ? mapSelectRow(row) : null;
}

export function listPaymentProjectionsSqlite(
  db: WaiaDb,
  context: OrgContext,
  query: ListPaymentsQuery = {},
): PaymentProjectionView[] {
  const scoped = requireOrgContext(context.organizationId);
  const limit = resolveListLimit(query.limit);
  const conditions = [orgScopedWhere(payments.organizationId, scoped)];

  if (query.subjectModule) {
    conditions.push(eq(payments.subjectModule, query.subjectModule));
  }
  if (query.subjectInvoiceId) {
    conditions.push(eq(payments.subjectInvoiceId, query.subjectInvoiceId));
  }
  if (query.status) {
    conditions.push(eq(payments.status, query.status));
  }

  const rows = db
    .select()
    .from(payments)
    .where(and(...conditions))
    .orderBy(desc(payments.updatedAt), desc(payments.paymentId))
    .limit(limit)
    .all();

  return rows.map(mapSelectRow);
}

export function deleteAllPaymentProjectionsForOrgSqlite(db: WaiaDb, context: OrgContext): number {
  const scoped = requireOrgContext(context.organizationId);
  const result = db.delete(payments).where(orgScopedWhere(payments.organizationId, scoped)).run();
  return result.changes;
}

export function deletePaymentProjectionByIdSqlite(
  db: WaiaDb,
  context: OrgContext,
  paymentId: string,
): boolean {
  const scoped = requireOrgContext(context.organizationId);
  const result = db
    .delete(payments)
    .where(and(eq(payments.paymentId, paymentId), orgScopedWhere(payments.organizationId, scoped)))
    .run();
  return result.changes > 0;
}

export function upsertPaymentProjectionSqliteTx(
  db: WaiaDb,
  context: OrgContext,
  projection: PaymentProjectionView,
): Promise<PaymentProjectionView> {
  return runSqliteTransaction(db, (tx) => upsertPaymentProjectionSqlite(tx, context, projection));
}
