import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, eq } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { PaymentWalletView } from "@/lib/waia-core/payment-addresses/payment-address-events.types";
import {
  mapPaymentWalletRow,
  paymentWalletToInsertValues,
} from "@/lib/waia-core/payment-addresses/payment-wallet-row-mapper";
import type { CreatePaymentWalletInput } from "@/lib/waia-core/payment-addresses/payment-wallet-repository.types";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgReadExecutor = Pick<WaiaPostgresDb, "select">;
type PgWriteExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

export async function insertPaymentWalletPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  input: CreatePaymentWalletInput,
): Promise<PaymentWalletView> {
  const scoped = requireOrgContext(context.organizationId);
  const id = crypto.randomUUID();
  const now = new Date();

  await ex
    .insert(pgSchema.paymentWallets)
    .values(paymentWalletToInsertValues(id, scoped.organizationId, input, now));

  const rows = await ex
    .select()
    .from(pgSchema.paymentWallets)
    .where(
      and(
        eq(pgSchema.paymentWallets.id, id),
        orgScopedWhere(pgSchema.paymentWallets.organizationId, scoped),
      ),
    )
    .limit(1);

  if (!rows[0]) {
    throw new Error("[waia-core] payment wallet insert failed");
  }
  return mapPaymentWalletRow(rows[0]);
}

export async function getPaymentWalletByIdPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  walletId: string,
): Promise<PaymentWalletView | null> {
  const scoped = requireOrgContext(context.organizationId);

  const rows = await ex
    .select()
    .from(pgSchema.paymentWallets)
    .where(
      and(
        eq(pgSchema.paymentWallets.id, walletId),
        orgScopedWhere(pgSchema.paymentWallets.organizationId, scoped),
      ),
    )
    .limit(1);

  return rows[0] ? mapPaymentWalletRow(rows[0]) : null;
}
