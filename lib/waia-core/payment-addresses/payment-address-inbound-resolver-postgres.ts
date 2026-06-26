import "server-only";

import { and, eq } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type {
  InboundAttribution,
  PaymentAddressInboundResolver,
} from "@/lib/waia-core/payment-addresses/payment-address-inbound-resolver.port";

type PgInboundResolverExecutor = Pick<WaiaPostgresDb, "select">;

function mapRow(row: typeof pgSchema.paymentAddresses.$inferSelect): InboundAttribution {
  return {
    addressId: row.addressId,
    organizationId: row.organizationId,
    status: row.status,
    subjectModule: row.subjectModule,
  };
}

export async function resolveOwnerByDepositAddressPostgres(
  ex: PgInboundResolverExecutor,
  network: string,
  address: string,
): Promise<InboundAttribution | null> {
  const rows = await ex
    .select()
    .from(pgSchema.paymentAddresses)
    .where(
      and(
        eq(pgSchema.paymentAddresses.network, network),
        eq(pgSchema.paymentAddresses.address, address),
      ),
    )
    .limit(1);

  const row = rows[0];
  return row ? mapRow(row) : null;
}

export function createPostgresPaymentAddressInboundResolver(
  ex: PgInboundResolverExecutor,
): PaymentAddressInboundResolver {
  return {
    resolveOwnerByDepositAddress(network, address) {
      return resolveOwnerByDepositAddressPostgres(ex, network, address);
    },
  };
}
