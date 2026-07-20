import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, asc, eq } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { runWaiaPostgresTransaction } from "@/db/waia-postgres-transaction";
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

type PgReadExecutor = Pick<WaiaPostgresDb, "select">;
type PgWriteExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

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

function isPgUniqueViolation(error: unknown): boolean {
  if (error && typeof error === "object" && "code" in error) {
    return (error as { code: string }).code === "23505";
  }
  return false;
}

function getPgConstraintName(error: unknown): string | null {
  if (error && typeof error === "object" && "constraint" in error) {
    const constraint = (error as { constraint?: string }).constraint;
    return constraint ?? null;
  }
  return null;
}

function mapSelectRow(
  row: typeof pgSchema.paymentAddressEvents.$inferSelect,
): PaymentAddressEventRecordView {
  return mapPaymentAddressEventRow(row);
}

export async function insertPaymentAddressEventPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  input: InsertPaymentAddressEventRepoInput,
): Promise<PaymentAddressEventRecordView> {
  const scoped = requireOrgContext(context.organizationId);
  const id = crypto.randomUUID();
  const now = new Date();
  const { payload } = input;

  try {
    await ex
      .insert(pgSchema.paymentAddressEvents)
      .values(paymentAddressEventPayloadToInsertValues(id, scoped.organizationId, payload, now));
  } catch (error) {
    if (isPgUniqueViolation(error)) {
      const constraint = getPgConstraintName(error);
      if (constraint === "payment_address_events_address_id_seq_unique") {
        throw new AddressIdempotencyConflictError(`${payload.addressId}:${payload.seq}`);
      }
    }
    throw error;
  }

  const rows = await ex
    .select()
    .from(pgSchema.paymentAddressEvents)
    .where(
      and(
        eq(pgSchema.paymentAddressEvents.id, id),
        orgScopedWhere(pgSchema.paymentAddressEvents.organizationId, scoped),
      ),
    )
    .limit(1);

  if (!rows[0]) {
    throw new Error("[waia-core] payment address event insert failed");
  }
  return mapSelectRow(rows[0]);
}

export async function listPaymentAddressEventsPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  query: ListPaymentAddressEventsQuery = {},
): Promise<PaymentAddressEventRecordView[]> {
  const scoped = requireOrgContext(context.organizationId);
  const limit = resolveListLimit(query.limit);
  const conditions = [orgScopedWhere(pgSchema.paymentAddressEvents.organizationId, scoped)];

  if (query.addressId) {
    conditions.push(eq(pgSchema.paymentAddressEvents.addressId, query.addressId));
  }

  const rows = await ex
    .select()
    .from(pgSchema.paymentAddressEvents)
    .where(and(...conditions))
    .orderBy(asc(pgSchema.paymentAddressEvents.seq), asc(pgSchema.paymentAddressEvents.createdAt))
    .limit(limit);

  return rows.map(mapSelectRow);
}

export async function listPaymentAddressEventsForAddressPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  addressId: string,
): Promise<PaymentAddressEventRecordView[]> {
  const scoped = requireOrgContext(context.organizationId);

  const rows = await ex
    .select()
    .from(pgSchema.paymentAddressEvents)
    .where(
      and(
        orgScopedWhere(pgSchema.paymentAddressEvents.organizationId, scoped),
        eq(pgSchema.paymentAddressEvents.addressId, addressId),
      ),
    )
    .orderBy(asc(pgSchema.paymentAddressEvents.seq));

  return rows.map(mapSelectRow);
}

export async function insertPaymentAddressEventPostgresTx(
  db: WaiaPostgresDb,
  context: OrgContext,
  input: InsertPaymentAddressEventRepoInput,
): Promise<PaymentAddressEventRecordView> {
  return runWaiaPostgresTransaction(db, (tx) =>
    insertPaymentAddressEventPostgres(tx, context, input),
  );
}
