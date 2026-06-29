import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, eq } from "drizzle-orm";

import { paymentWallets } from "@/db/schema";
import type { WaiaDb } from "@/db/types";
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

export function insertPaymentWalletSqlite(
  db: WaiaDb,
  context: OrgContext,
  input: CreatePaymentWalletInput,
): PaymentWalletView {
  const scoped = requireOrgContext(context.organizationId);
  const id = crypto.randomUUID();
  const now = new Date();

  db.insert(paymentWallets)
    .values(paymentWalletToInsertValues(id, scoped.organizationId, input, now))
    .run();

  const row = db
    .select()
    .from(paymentWallets)
    .where(and(eq(paymentWallets.id, id), orgScopedWhere(paymentWallets.organizationId, scoped)))
    .limit(1)
    .all()[0];

  if (!row) {
    throw new Error("[waia-core] payment wallet insert failed");
  }
  return mapPaymentWalletRow(row);
}

export function getPaymentWalletByIdSqlite(
  db: WaiaDb,
  context: OrgContext,
  walletId: string,
): PaymentWalletView | null {
  const scoped = requireOrgContext(context.organizationId);

  const row = db
    .select()
    .from(paymentWallets)
    .where(
      and(eq(paymentWallets.id, walletId), orgScopedWhere(paymentWallets.organizationId, scoped)),
    )
    .limit(1)
    .all()[0];

  return row ? mapPaymentWalletRow(row) : null;
}
