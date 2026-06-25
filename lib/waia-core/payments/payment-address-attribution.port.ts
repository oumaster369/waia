import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { PaymentAddressProjectionView } from "@/lib/waia-core/payment-addresses/payment-address-projection.types";
import {
  createPostgresPaymentAddressProjectionRepository,
  createSqlitePaymentAddressProjectionRepository,
} from "@/lib/waia-core/payment-addresses/payment-address-repository-adapters";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export type PaymentAddressAttributionReader = {
  getAddressForAttribution(
    context: OrgContext,
    addressId: string,
  ): Promise<PaymentAddressProjectionView | null>;
};

type PgPaymentAddressAttributionExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "delete">;

export function createSqlitePaymentAddressAttributionReader(
  db: WaiaDb,
): PaymentAddressAttributionReader {
  const projectionRepository = createSqlitePaymentAddressProjectionRepository(db);
  return {
    getAddressForAttribution(context, addressId) {
      return Promise.resolve(projectionRepository.getByAddressId(context, addressId));
    },
  };
}

export function createPostgresPaymentAddressAttributionReader(
  ex: PgPaymentAddressAttributionExecutor,
): PaymentAddressAttributionReader {
  const projectionRepository = createPostgresPaymentAddressProjectionRepository(ex);
  return {
    getAddressForAttribution(context, addressId) {
      return projectionRepository.getByAddressId(context, addressId);
    },
  };
}
