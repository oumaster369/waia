import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, desc, eq } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { runWaiaPostgresTransaction } from "@/db/waia-postgres-transaction";
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

type PgReadExecutor = Pick<WaiaPostgresDb, "select" | "delete">;
type PgWriteExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "delete">;

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

function mapSelectRow(row: typeof pgSchema.payments.$inferSelect): PaymentProjectionView {
  return mapPaymentProjectionRow(row);
}

export async function upsertPaymentProjectionPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  projection: PaymentProjectionView,
): Promise<PaymentProjectionView> {
  const scoped = requireOrgContext(context.organizationId);
  const now = new Date();

  await ex
    .insert(pgSchema.payments)
    .values(paymentProjectionToUpsertValues(projection, now))
    .onConflictDoUpdate({
      target: pgSchema.payments.paymentId,
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
    });

  const rows = await ex
    .select()
    .from(pgSchema.payments)
    .where(
      and(
        eq(pgSchema.payments.paymentId, projection.paymentId),
        orgScopedWhere(pgSchema.payments.organizationId, scoped),
      ),
    )
    .limit(1);

  if (!rows[0]) {
    throw new Error("[waia-core] payment projection upsert failed");
  }
  return mapSelectRow(rows[0]);
}

export async function getPaymentProjectionByIdPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  paymentId: string,
): Promise<PaymentProjectionView | null> {
  const scoped = requireOrgContext(context.organizationId);

  const rows = await ex
    .select()
    .from(pgSchema.payments)
    .where(
      and(
        eq(pgSchema.payments.paymentId, paymentId),
        orgScopedWhere(pgSchema.payments.organizationId, scoped),
      ),
    )
    .limit(1);

  return rows[0] ? mapSelectRow(rows[0]) : null;
}

export async function listPaymentProjectionsPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  query: ListPaymentsQuery = {},
): Promise<PaymentProjectionView[]> {
  const scoped = requireOrgContext(context.organizationId);
  const limit = resolveListLimit(query.limit);
  const conditions = [orgScopedWhere(pgSchema.payments.organizationId, scoped)];

  if (query.subjectModule) {
    conditions.push(eq(pgSchema.payments.subjectModule, query.subjectModule));
  }
  if (query.subjectInvoiceId) {
    conditions.push(eq(pgSchema.payments.subjectInvoiceId, query.subjectInvoiceId));
  }
  if (query.status) {
    conditions.push(eq(pgSchema.payments.status, query.status));
  }

  const rows = await ex
    .select()
    .from(pgSchema.payments)
    .where(and(...conditions))
    .orderBy(desc(pgSchema.payments.updatedAt), desc(pgSchema.payments.paymentId))
    .limit(limit);

  return rows.map(mapSelectRow);
}

export async function deleteAllPaymentProjectionsForOrgPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
): Promise<number> {
  const scoped = requireOrgContext(context.organizationId);
  const deleted = await ex
    .delete(pgSchema.payments)
    .where(orgScopedWhere(pgSchema.payments.organizationId, scoped))
    .returning({ paymentId: pgSchema.payments.paymentId });
  return deleted.length;
}

export async function deletePaymentProjectionByIdPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  paymentId: string,
): Promise<boolean> {
  const scoped = requireOrgContext(context.organizationId);
  const deleted = await ex
    .delete(pgSchema.payments)
    .where(
      and(
        eq(pgSchema.payments.paymentId, paymentId),
        orgScopedWhere(pgSchema.payments.organizationId, scoped),
      ),
    )
    .returning({ paymentId: pgSchema.payments.paymentId });
  return deleted.length > 0;
}

export async function upsertPaymentProjectionPostgresTx(
  db: WaiaPostgresDb,
  context: OrgContext,
  projection: PaymentProjectionView,
): Promise<PaymentProjectionView> {
  return runWaiaPostgresTransaction(db, (tx) =>
    upsertPaymentProjectionPostgres(tx, context, projection),
  );
}
