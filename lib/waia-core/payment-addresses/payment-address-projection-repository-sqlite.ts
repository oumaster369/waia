import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, desc, eq } from "drizzle-orm";

import { paymentAddresses } from "@/db/schema";
import type { WaiaDb } from "@/db/types";
import { runSqliteTransaction } from "@/db/types";
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

function isSqliteUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}

function mapSelectRow(row: typeof paymentAddresses.$inferSelect): PaymentAddressProjectionView {
  return mapPaymentAddressProjectionRow(row);
}

export function upsertPaymentAddressProjectionSqlite(
  db: WaiaDb,
  context: OrgContext,
  projection: PaymentAddressProjectionView,
): PaymentAddressProjectionView {
  const scoped = requireOrgContext(context.organizationId);
  const now = new Date();

  try {
    db.insert(paymentAddresses)
      .values(paymentAddressProjectionToUpsertValues(projection, now))
      .onConflictDoUpdate({
        target: paymentAddresses.addressId,
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
      })
      .run();
  } catch (error) {
    if (isSqliteUniqueViolation(error)) {
      if (
        error instanceof Error &&
        /network/.test(error.message) &&
        /address/.test(error.message)
      ) {
        throw new AddressAlreadyExistsError(projection.network, projection.address);
      }
      throw new AddressAlreadyAssignedError(projection.addressId);
    }
    throw error;
  }

  const row = db
    .select()
    .from(paymentAddresses)
    .where(
      and(
        eq(paymentAddresses.addressId, projection.addressId),
        orgScopedWhere(paymentAddresses.organizationId, scoped),
      ),
    )
    .limit(1)
    .all()[0];

  if (!row) {
    throw new Error("[waia-core] payment address projection upsert failed");
  }
  return mapSelectRow(row);
}

export function getPaymentAddressProjectionByIdSqlite(
  db: WaiaDb,
  context: OrgContext,
  addressId: string,
): PaymentAddressProjectionView | null {
  const scoped = requireOrgContext(context.organizationId);

  const row = db
    .select()
    .from(paymentAddresses)
    .where(
      and(
        eq(paymentAddresses.addressId, addressId),
        orgScopedWhere(paymentAddresses.organizationId, scoped),
      ),
    )
    .limit(1)
    .all()[0];

  return row ? mapSelectRow(row) : null;
}

export function getPaymentAddressProjectionByNetworkAddressSqlite(
  db: WaiaDb,
  context: OrgContext,
  network: string,
  address: string,
): PaymentAddressProjectionView | null {
  const scoped = requireOrgContext(context.organizationId);

  const row = db
    .select()
    .from(paymentAddresses)
    .where(
      and(
        eq(paymentAddresses.network, network),
        eq(paymentAddresses.address, address),
        orgScopedWhere(paymentAddresses.organizationId, scoped),
      ),
    )
    .limit(1)
    .all()[0];

  return row ? mapSelectRow(row) : null;
}

export function findActivePaymentAddressBySubjectSqlite(
  db: WaiaDb,
  context: OrgContext,
  subjectModule: PaymentAddressSubjectModule,
  subjectRef: string,
): PaymentAddressProjectionView | null {
  const scoped = requireOrgContext(context.organizationId);

  const row = db
    .select()
    .from(paymentAddresses)
    .where(
      and(
        orgScopedWhere(paymentAddresses.organizationId, scoped),
        eq(paymentAddresses.subjectModule, subjectModule),
        eq(paymentAddresses.subjectRef, subjectRef),
        eq(paymentAddresses.status, "ACTIVATED"),
      ),
    )
    .limit(1)
    .all()[0];

  return row ? mapSelectRow(row) : null;
}

export function listPaymentAddressProjectionsSqlite(
  db: WaiaDb,
  context: OrgContext,
  query: ListPaymentAddressesQuery = {},
): PaymentAddressProjectionView[] {
  const scoped = requireOrgContext(context.organizationId);
  const limit = resolveListLimit(query.limit);
  const conditions = [orgScopedWhere(paymentAddresses.organizationId, scoped)];

  if (query.status) {
    conditions.push(eq(paymentAddresses.status, query.status));
  }
  if (query.subjectModule) {
    conditions.push(eq(paymentAddresses.subjectModule, query.subjectModule));
  }
  if (query.subjectRef) {
    conditions.push(eq(paymentAddresses.subjectRef, query.subjectRef));
  }
  if (query.walletId) {
    conditions.push(eq(paymentAddresses.walletId, query.walletId));
  }

  const rows = db
    .select()
    .from(paymentAddresses)
    .where(and(...conditions))
    .orderBy(desc(paymentAddresses.updatedAt), desc(paymentAddresses.addressId))
    .limit(limit)
    .all();

  return rows.map(mapSelectRow);
}

export function deleteAllPaymentAddressProjectionsForOrgSqlite(
  db: WaiaDb,
  context: OrgContext,
): number {
  const scoped = requireOrgContext(context.organizationId);
  const result = db
    .delete(paymentAddresses)
    .where(orgScopedWhere(paymentAddresses.organizationId, scoped))
    .run();
  return result.changes;
}

export function deletePaymentAddressProjectionByIdSqlite(
  db: WaiaDb,
  context: OrgContext,
  addressId: string,
): boolean {
  const scoped = requireOrgContext(context.organizationId);
  const result = db
    .delete(paymentAddresses)
    .where(
      and(
        eq(paymentAddresses.addressId, addressId),
        orgScopedWhere(paymentAddresses.organizationId, scoped),
      ),
    )
    .run();
  return result.changes > 0;
}

export function upsertPaymentAddressProjectionSqliteTx(
  db: WaiaDb,
  context: OrgContext,
  projection: PaymentAddressProjectionView,
): Promise<PaymentAddressProjectionView> {
  return runSqliteTransaction(db, (tx) =>
    upsertPaymentAddressProjectionSqlite(tx, context, projection),
  );
}
