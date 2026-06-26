import "server-only";

import { and, eq } from "drizzle-orm";

import { paymentAddresses } from "@/db/schema";
import type { WaiaDb } from "@/db/types";
import type {
  InboundAttribution,
  PaymentAddressInboundResolver,
} from "@/lib/waia-core/payment-addresses/payment-address-inbound-resolver.port";

function mapRow(row: typeof paymentAddresses.$inferSelect): InboundAttribution {
  return {
    addressId: row.addressId,
    organizationId: row.organizationId,
    status: row.status,
    subjectModule: row.subjectModule,
  };
}

export function resolveOwnerByDepositAddressSqlite(
  db: WaiaDb,
  network: string,
  address: string,
): InboundAttribution | null {
  const row = db
    .select()
    .from(paymentAddresses)
    .where(and(eq(paymentAddresses.network, network), eq(paymentAddresses.address, address)))
    .limit(1)
    .all()[0];

  return row ? mapRow(row) : null;
}

export function createSqlitePaymentAddressInboundResolver(
  db: WaiaDb,
): PaymentAddressInboundResolver {
  return {
    resolveOwnerByDepositAddress(network, address) {
      return Promise.resolve(resolveOwnerByDepositAddressSqlite(db, network, address));
    },
  };
}
