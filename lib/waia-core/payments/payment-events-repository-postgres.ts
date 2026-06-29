import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, asc, eq } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { runWaiaPostgresTransaction } from "@/db/waia-postgres-transaction";
import {
  PaymentIdempotencyConflictError,
  PaymentSettlementAlreadyAttributedError,
} from "@/lib/waia-core/payments/payment.errors";
import {
  mapPaymentEventRow,
  paymentEventPayloadToInsertValues,
} from "@/lib/waia-core/payments/payment-events-row-mapper";
import type {
  InsertPaymentEventRepoInput,
  ListPaymentEventsQuery,
} from "@/lib/waia-core/payments/payment-events-repository.types";
import {
  DEFAULT_PAYMENT_EVENTS_LIST_LIMIT,
  MAX_PAYMENT_EVENTS_LIST_LIMIT,
} from "@/lib/waia-core/payments/payment-events-repository.types";
import type { PaymentEventRecordView } from "@/lib/waia-core/payments/payment-events.types";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgReadExecutor = Pick<WaiaPostgresDb, "select">;
type PgWriteExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

function resolveListLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_PAYMENT_EVENTS_LIST_LIMIT;
  }
  const normalized = Math.trunc(limit);
  if (normalized <= 0) {
    return DEFAULT_PAYMENT_EVENTS_LIST_LIMIT;
  }
  return Math.min(normalized, MAX_PAYMENT_EVENTS_LIST_LIMIT);
}

function isPgUniqueViolation(error: unknown): boolean {
  if (error && typeof error === "object" && "code" in error) {
    return (error as { code: string }).code === "23505";
  }
  return false;
}

function mapSelectRow(row: typeof pgSchema.paymentEvents.$inferSelect): PaymentEventRecordView {
  return mapPaymentEventRow(row);
}

export async function insertPaymentEventPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  input: InsertPaymentEventRepoInput,
): Promise<PaymentEventRecordView> {
  const scoped = requireOrgContext(context.organizationId);
  const id = crypto.randomUUID();
  const now = new Date();
  const { payload } = input;

  try {
    await ex
      .insert(pgSchema.paymentEvents)
      .values(paymentEventPayloadToInsertValues(id, scoped.organizationId, payload, now));
  } catch (error) {
    if (isPgUniqueViolation(error)) {
      if (payload.idempotencyKey) {
        throw new PaymentIdempotencyConflictError(payload.idempotencyKey);
      }
      if (payload.settlement) {
        throw new PaymentSettlementAlreadyAttributedError(
          payload.settlement.settlementNetwork,
          payload.settlement.settlementTxHash,
          payload.settlement.transferIndex,
        );
      }
    }
    throw error;
  }

  const rows = await ex
    .select()
    .from(pgSchema.paymentEvents)
    .where(
      and(
        eq(pgSchema.paymentEvents.id, id),
        orgScopedWhere(pgSchema.paymentEvents.organizationId, scoped),
      ),
    )
    .limit(1);

  if (!rows[0]) {
    throw new Error("[waia-core] payment event insert failed");
  }
  return mapSelectRow(rows[0]);
}

export async function listPaymentEventsPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  query: ListPaymentEventsQuery = {},
): Promise<PaymentEventRecordView[]> {
  const scoped = requireOrgContext(context.organizationId);
  const limit = resolveListLimit(query.limit);
  const conditions = [orgScopedWhere(pgSchema.paymentEvents.organizationId, scoped)];

  if (query.paymentId) {
    conditions.push(eq(pgSchema.paymentEvents.paymentId, query.paymentId));
  }

  const rows = await ex
    .select()
    .from(pgSchema.paymentEvents)
    .where(and(...conditions))
    .orderBy(asc(pgSchema.paymentEvents.seq), asc(pgSchema.paymentEvents.createdAt))
    .limit(limit);

  return rows.map(mapSelectRow);
}

export async function findPaymentEventByIdempotencyKeyPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  idempotencyKey: string,
): Promise<PaymentEventRecordView | null> {
  const scoped = requireOrgContext(context.organizationId);

  const rows = await ex
    .select()
    .from(pgSchema.paymentEvents)
    .where(
      and(
        orgScopedWhere(pgSchema.paymentEvents.organizationId, scoped),
        eq(pgSchema.paymentEvents.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);

  return rows[0] ? mapSelectRow(rows[0]) : null;
}

export async function findPaymentEventBySettlementAttributionPostgres(
  ex: PgReadExecutor,
  settlementNetwork: string,
  settlementTxHash: string,
  transferIndex: number,
): Promise<PaymentEventRecordView | null> {
  const rows = await ex
    .select()
    .from(pgSchema.paymentEvents)
    .where(
      and(
        eq(pgSchema.paymentEvents.settlementNetwork, settlementNetwork),
        eq(pgSchema.paymentEvents.settlementTxHash, settlementTxHash),
        eq(pgSchema.paymentEvents.transferIndex, transferIndex),
      ),
    )
    .limit(1);

  return rows[0] ? mapSelectRow(rows[0]) : null;
}

export async function listPaymentEventsForPaymentPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  paymentId: string,
): Promise<PaymentEventRecordView[]> {
  const scoped = requireOrgContext(context.organizationId);

  const rows = await ex
    .select()
    .from(pgSchema.paymentEvents)
    .where(
      and(
        orgScopedWhere(pgSchema.paymentEvents.organizationId, scoped),
        eq(pgSchema.paymentEvents.paymentId, paymentId),
      ),
    )
    .orderBy(asc(pgSchema.paymentEvents.seq));

  return rows.map(mapSelectRow);
}

export async function insertPaymentEventPostgresTx(
  db: WaiaPostgresDb,
  context: OrgContext,
  input: InsertPaymentEventRepoInput,
): Promise<PaymentEventRecordView> {
  return runWaiaPostgresTransaction(db, (tx) => insertPaymentEventPostgres(tx, context, input));
}
