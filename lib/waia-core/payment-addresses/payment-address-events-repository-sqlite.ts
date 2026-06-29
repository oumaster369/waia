import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, asc, eq } from "drizzle-orm";

import { paymentAddressEvents } from "@/db/schema";
import type { WaiaDb } from "@/db/types";
import { runSqliteTransaction } from "@/db/types";
import { AddressIdempotencyConflictError } from "@/lib/waia-core/payment-addresses/payment-address.errors";
import {
  mapPaymentAddressEventRow,
  paymentAddressEventPayloadToInsertValues,
} from "@/lib/waia-core/payment-addresses/payment-address-events-row-mapper";
import type {
  InsertPaymentAddressEventRepoInput,
  ListPaymentAddressEventsQuery,
} from "@/lib/waia-core/payment-addresses/payment-address-events-repository.types";
import {
  DEFAULT_PAYMENT_ADDRESS_EVENTS_LIST_LIMIT,
  MAX_PAYMENT_ADDRESS_EVENTS_LIST_LIMIT,
} from "@/lib/waia-core/payment-addresses/payment-address-events-repository.types";
import type { PaymentAddressEventRecordView } from "@/lib/waia-core/payment-addresses/payment-address-events.types";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

function resolveListLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_PAYMENT_ADDRESS_EVENTS_LIST_LIMIT;
  }
  const normalized = Math.trunc(limit);
  if (normalized <= 0) {
    return DEFAULT_PAYMENT_ADDRESS_EVENTS_LIST_LIMIT;
  }
  return Math.min(normalized, MAX_PAYMENT_ADDRESS_EVENTS_LIST_LIMIT);
}

function isSqliteUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}

function mapSelectRow(
  row: typeof paymentAddressEvents.$inferSelect,
): PaymentAddressEventRecordView {
  return mapPaymentAddressEventRow(row);
}

export function insertPaymentAddressEventSqlite(
  db: WaiaDb,
  context: OrgContext,
  input: InsertPaymentAddressEventRepoInput,
): PaymentAddressEventRecordView {
  const scoped = requireOrgContext(context.organizationId);
  const id = crypto.randomUUID();
  const now = new Date();
  const { payload } = input;

  try {
    db.insert(paymentAddressEvents)
      .values(paymentAddressEventPayloadToInsertValues(id, scoped.organizationId, payload, now))
      .run();
  } catch (error) {
    if (isSqliteUniqueViolation(error)) {
      throw new AddressIdempotencyConflictError(`${payload.addressId}:${payload.seq}`);
    }
    throw error;
  }

  const row = db
    .select()
    .from(paymentAddressEvents)
    .where(
      and(
        eq(paymentAddressEvents.id, id),
        orgScopedWhere(paymentAddressEvents.organizationId, scoped),
      ),
    )
    .limit(1)
    .all()[0];

  if (!row) {
    throw new Error("[waia-core] payment address event insert failed");
  }
  return mapSelectRow(row);
}

export function listPaymentAddressEventsSqlite(
  db: WaiaDb,
  context: OrgContext,
  query: ListPaymentAddressEventsQuery = {},
): PaymentAddressEventRecordView[] {
  const scoped = requireOrgContext(context.organizationId);
  const limit = resolveListLimit(query.limit);
  const conditions = [orgScopedWhere(paymentAddressEvents.organizationId, scoped)];

  if (query.addressId) {
    conditions.push(eq(paymentAddressEvents.addressId, query.addressId));
  }

  const rows = db
    .select()
    .from(paymentAddressEvents)
    .where(and(...conditions))
    .orderBy(asc(paymentAddressEvents.seq), asc(paymentAddressEvents.createdAt))
    .limit(limit)
    .all();

  return rows.map(mapSelectRow);
}

export function listPaymentAddressEventsForAddressSqlite(
  db: WaiaDb,
  context: OrgContext,
  addressId: string,
): PaymentAddressEventRecordView[] {
  const scoped = requireOrgContext(context.organizationId);

  const rows = db
    .select()
    .from(paymentAddressEvents)
    .where(
      and(
        orgScopedWhere(paymentAddressEvents.organizationId, scoped),
        eq(paymentAddressEvents.addressId, addressId),
      ),
    )
    .orderBy(asc(paymentAddressEvents.seq))
    .all();

  return rows.map(mapSelectRow);
}

export function insertPaymentAddressEventSqliteTx(
  db: WaiaDb,
  context: OrgContext,
  input: InsertPaymentAddressEventRepoInput,
): Promise<PaymentAddressEventRecordView> {
  return runSqliteTransaction(db, (tx) => insertPaymentAddressEventSqlite(tx, context, input));
}
