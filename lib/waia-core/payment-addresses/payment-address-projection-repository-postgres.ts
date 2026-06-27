import "server-only";

import { and, desc, eq } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { runWaiaPostgresTransaction } from "@/db/waia-postgres-transaction";
import {
  AddressAlreadyAssignedError,
  AddressAlreadyExistsError,
} from "@/lib/waia-core/payment-addresses/payment-address.errors";
import {
  mapPaymentAddressProjectionRow,
  paymentAddressProjectionToUpsertValues,
} from "@/lib/waia-core/payment-addresses/payment-address-projection-row-mapper";
import type { ListPaymentAddressesQuery } from "@/lib/waia-core/payment-addresses/payment-address-projection-repository.types";
import {
  DEFAULT_PAYMENT_ADDRESSES_LIST_LIMIT,
  MAX_PAYMENT_ADDRESSES_LIST_LIMIT,
} from "@/lib/waia-core/payment-addresses/payment-address-projection-repository.types";
import type { PaymentAddressSubjectModule } from "@/lib/waia-core/payment-addresses/payment-address-events.types";
import type { PaymentAddressProjectionView } from "@/lib/waia-core/payment-addresses/payment-address-projection.types";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgReadExecutor = Pick<WaiaPostgresDb, "select" | "delete">;
type PgWriteExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "delete">;

function resolveListLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_PAYMENT_ADDRESSES_LIST_LIMIT;
  }
  const normalized = Math.trunc(limit);
  if (normalized <= 0) {
    return DEFAULT_PAYMENT_ADDRESSES_LIST_LIMIT;
  }
  return Math.min(normalized, MAX_PAYMENT_ADDRESSES_LIST_LIMIT);
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
  row: typeof pgSchema.paymentAddresses.$inferSelect,
): PaymentAddressProjectionView {
  return mapPaymentAddressProjectionRow(row);
}

export async function upsertPaymentAddressProjectionPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  projection: PaymentAddressProjectionView,
): Promise<PaymentAddressProjectionView> {
  const scoped = requireOrgContext(context.organizationId);
  const now = new Date();

  try {
    await ex
      .insert(pgSchema.paymentAddresses)
      .values(paymentAddressProjectionToUpsertValues(projection, now))
      .onConflictDoUpdate({
        target: pgSchema.paymentAddresses.addressId,
        set: {
          walletId: projection.walletId,
          status: projection.status,
          subjectModule: projection.subjectModule,
          subjectRef: projection.subjectRef,
          bindingRef: projection.bindingRef,
          lastEventSeq: projection.lastEventSeq,
          lastEventDigest: projection.lastEventDigest,
          updatedAt: now,
        },
      });
  } catch (error) {
    if (isPgUniqueViolation(error)) {
      const constraint = getPgConstraintName(error);
      if (constraint === "payment_addresses_network_address_unique") {
        throw new AddressAlreadyExistsError(projection.network, projection.address);
      }
      if (constraint === "payment_addresses_org_subject_active_unique") {
        throw new AddressAlreadyAssignedError(projection.addressId);
      }
    }
    throw error;
  }

  const rows = await ex
    .select()
    .from(pgSchema.paymentAddresses)
    .where(
      and(
        eq(pgSchema.paymentAddresses.addressId, projection.addressId),
        orgScopedWhere(pgSchema.paymentAddresses.organizationId, scoped),
      ),
    )
    .limit(1);

  if (!rows[0]) {
    throw new Error("[waia-core] payment address projection upsert failed");
  }
  return mapSelectRow(rows[0]);
}

export async function getPaymentAddressProjectionByIdPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  addressId: string,
): Promise<PaymentAddressProjectionView | null> {
  const scoped = requireOrgContext(context.organizationId);

  const rows = await ex
    .select()
    .from(pgSchema.paymentAddresses)
    .where(
      and(
        eq(pgSchema.paymentAddresses.addressId, addressId),
        orgScopedWhere(pgSchema.paymentAddresses.organizationId, scoped),
      ),
    )
    .limit(1);

  return rows[0] ? mapSelectRow(rows[0]) : null;
}

export async function getPaymentAddressProjectionByNetworkAddressPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  network: string,
  address: string,
): Promise<PaymentAddressProjectionView | null> {
  const scoped = requireOrgContext(context.organizationId);

  const rows = await ex
    .select()
    .from(pgSchema.paymentAddresses)
    .where(
      and(
        eq(pgSchema.paymentAddresses.network, network),
        eq(pgSchema.paymentAddresses.address, address),
        orgScopedWhere(pgSchema.paymentAddresses.organizationId, scoped),
      ),
    )
    .limit(1);

  return rows[0] ? mapSelectRow(rows[0]) : null;
}

export async function findActivePaymentAddressBySubjectPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  subjectModule: PaymentAddressSubjectModule,
  subjectRef: string,
): Promise<PaymentAddressProjectionView | null> {
  const scoped = requireOrgContext(context.organizationId);

  const rows = await ex
    .select()
    .from(pgSchema.paymentAddresses)
    .where(
      and(
        orgScopedWhere(pgSchema.paymentAddresses.organizationId, scoped),
        eq(pgSchema.paymentAddresses.subjectModule, subjectModule),
        eq(pgSchema.paymentAddresses.subjectRef, subjectRef),
        eq(pgSchema.paymentAddresses.status, "ACTIVATED"),
      ),
    )
    .limit(1);

  return rows[0] ? mapSelectRow(rows[0]) : null;
}

export async function listPaymentAddressProjectionsPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  query: ListPaymentAddressesQuery = {},
): Promise<PaymentAddressProjectionView[]> {
  const scoped = requireOrgContext(context.organizationId);
  const limit = resolveListLimit(query.limit);
  const conditions = [orgScopedWhere(pgSchema.paymentAddresses.organizationId, scoped)];

  if (query.status) {
    conditions.push(eq(pgSchema.paymentAddresses.status, query.status));
  }
  if (query.subjectModule) {
    conditions.push(eq(pgSchema.paymentAddresses.subjectModule, query.subjectModule));
  }
  if (query.subjectRef) {
    conditions.push(eq(pgSchema.paymentAddresses.subjectRef, query.subjectRef));
  }
  if (query.walletId) {
    conditions.push(eq(pgSchema.paymentAddresses.walletId, query.walletId));
  }

  const rows = await ex
    .select()
    .from(pgSchema.paymentAddresses)
    .where(and(...conditions))
    .orderBy(desc(pgSchema.paymentAddresses.updatedAt), desc(pgSchema.paymentAddresses.addressId))
    .limit(limit);

  return rows.map(mapSelectRow);
}

export async function deleteAllPaymentAddressProjectionsForOrgPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
): Promise<number> {
  const scoped = requireOrgContext(context.organizationId);
  const deleted = await ex
    .delete(pgSchema.paymentAddresses)
    .where(orgScopedWhere(pgSchema.paymentAddresses.organizationId, scoped))
    .returning({ addressId: pgSchema.paymentAddresses.addressId });
  return deleted.length;
}

export async function deletePaymentAddressProjectionByIdPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  addressId: string,
): Promise<boolean> {
  const scoped = requireOrgContext(context.organizationId);
  const deleted = await ex
    .delete(pgSchema.paymentAddresses)
    .where(
      and(
        eq(pgSchema.paymentAddresses.addressId, addressId),
        orgScopedWhere(pgSchema.paymentAddresses.organizationId, scoped),
      ),
    )
    .returning({ addressId: pgSchema.paymentAddresses.addressId });
  return deleted.length > 0;
}

export async function upsertPaymentAddressProjectionPostgresTx(
  db: WaiaPostgresDb,
  context: OrgContext,
  projection: PaymentAddressProjectionView,
): Promise<PaymentAddressProjectionView> {
  return runWaiaPostgresTransaction(db, (tx) =>
    upsertPaymentAddressProjectionPostgres(tx, context, projection),
  );
}
