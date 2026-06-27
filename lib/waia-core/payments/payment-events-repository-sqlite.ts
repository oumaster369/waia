import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { paymentEvents } from "@/db/schema";
import type { WaiaDb } from "@/db/types";
import { runSqliteTransaction } from "@/db/types";
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

function isSqliteUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}

function mapSelectRow(row: typeof paymentEvents.$inferSelect): PaymentEventRecordView {
  return mapPaymentEventRow(row);
}

export function insertPaymentEventSqlite(
  db: WaiaDb,
  context: OrgContext,
  input: InsertPaymentEventRepoInput,
): PaymentEventRecordView {
  const scoped = requireOrgContext(context.organizationId);
  const id = crypto.randomUUID();
  const now = new Date();
  const { payload } = input;

  try {
    db.insert(paymentEvents)
      .values(paymentEventPayloadToInsertValues(id, scoped.organizationId, payload, now))
      .run();
  } catch (error) {
    if (isSqliteUniqueViolation(error)) {
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

  const row = db
    .select()
    .from(paymentEvents)
    .where(and(eq(paymentEvents.id, id), orgScopedWhere(paymentEvents.organizationId, scoped)))
    .limit(1)
    .all()[0];

  if (!row) {
    throw new Error("[waia-core] payment event insert failed");
  }
  return mapSelectRow(row);
}

export function listPaymentEventsSqlite(
  db: WaiaDb,
  context: OrgContext,
  query: ListPaymentEventsQuery = {},
): PaymentEventRecordView[] {
  const scoped = requireOrgContext(context.organizationId);
  const limit = resolveListLimit(query.limit);
  const conditions = [orgScopedWhere(paymentEvents.organizationId, scoped)];

  if (query.paymentId) {
    conditions.push(eq(paymentEvents.paymentId, query.paymentId));
  }

  const rows = db
    .select()
    .from(paymentEvents)
    .where(and(...conditions))
    .orderBy(asc(paymentEvents.seq), asc(paymentEvents.createdAt))
    .limit(limit)
    .all();

  return rows.map(mapSelectRow);
}

export function findPaymentEventByIdempotencyKeySqlite(
  db: WaiaDb,
  context: OrgContext,
  idempotencyKey: string,
): PaymentEventRecordView | null {
  const scoped = requireOrgContext(context.organizationId);

  const row = db
    .select()
    .from(paymentEvents)
    .where(
      and(
        orgScopedWhere(paymentEvents.organizationId, scoped),
        eq(paymentEvents.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1)
    .all()[0];

  return row ? mapSelectRow(row) : null;
}

export function findPaymentEventBySettlementAttributionSqlite(
  db: WaiaDb,
  settlementNetwork: string,
  settlementTxHash: string,
  transferIndex: number,
): PaymentEventRecordView | null {
  const row = db
    .select()
    .from(paymentEvents)
    .where(
      and(
        eq(paymentEvents.settlementNetwork, settlementNetwork),
        eq(paymentEvents.settlementTxHash, settlementTxHash),
        eq(paymentEvents.transferIndex, transferIndex),
      ),
    )
    .limit(1)
    .all()[0];

  return row ? mapSelectRow(row) : null;
}

export function listPaymentEventsForPaymentSqlite(
  db: WaiaDb,
  context: OrgContext,
  paymentId: string,
): PaymentEventRecordView[] {
  const scoped = requireOrgContext(context.organizationId);

  const rows = db
    .select()
    .from(paymentEvents)
    .where(
      and(
        orgScopedWhere(paymentEvents.organizationId, scoped),
        eq(paymentEvents.paymentId, paymentId),
      ),
    )
    .orderBy(asc(paymentEvents.seq))
    .all();

  return rows.map(mapSelectRow);
}

export function insertPaymentEventSqliteTx(
  db: WaiaDb,
  context: OrgContext,
  input: InsertPaymentEventRepoInput,
): Promise<PaymentEventRecordView> {
  return runSqliteTransaction(db, (tx) => insertPaymentEventSqlite(tx, context, input));
}
