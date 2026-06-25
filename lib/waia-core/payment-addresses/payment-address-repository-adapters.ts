import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { PaymentAddressEventsRepository } from "@/lib/waia-core/payment-addresses/payment-address-events-repository.types";
import {
  insertPaymentAddressEventPostgres,
  listPaymentAddressEventsForAddressPostgres,
  listPaymentAddressEventsPostgres,
} from "@/lib/waia-core/payment-addresses/payment-address-events-repository-postgres";
import {
  insertPaymentAddressEventSqlite,
  listPaymentAddressEventsForAddressSqlite,
  listPaymentAddressEventsSqlite,
} from "@/lib/waia-core/payment-addresses/payment-address-events-repository-sqlite";
import type { PaymentAddressProjectionRepository } from "@/lib/waia-core/payment-addresses/payment-address-projection-repository.types";
import {
  deleteAllPaymentAddressProjectionsForOrgPostgres,
  deletePaymentAddressProjectionByIdPostgres,
  findActivePaymentAddressBySubjectPostgres,
  getPaymentAddressProjectionByIdPostgres,
  getPaymentAddressProjectionByNetworkAddressPostgres,
  listPaymentAddressProjectionsPostgres,
  upsertPaymentAddressProjectionPostgres,
} from "@/lib/waia-core/payment-addresses/payment-address-projection-repository-postgres";
import {
  deleteAllPaymentAddressProjectionsForOrgSqlite,
  deletePaymentAddressProjectionByIdSqlite,
  findActivePaymentAddressBySubjectSqlite,
  getPaymentAddressProjectionByIdSqlite,
  getPaymentAddressProjectionByNetworkAddressSqlite,
  listPaymentAddressProjectionsSqlite,
  upsertPaymentAddressProjectionSqlite,
} from "@/lib/waia-core/payment-addresses/payment-address-projection-repository-sqlite";
import type { PaymentWalletRepository } from "@/lib/waia-core/payment-addresses/payment-wallet-repository.types";
import {
  getPaymentWalletByIdPostgres,
  insertPaymentWalletPostgres,
} from "@/lib/waia-core/payment-addresses/payment-wallet-repository-postgres";
import {
  getPaymentWalletByIdSqlite,
  insertPaymentWalletSqlite,
} from "@/lib/waia-core/payment-addresses/payment-wallet-repository-sqlite";

type PgPaymentAddressEventsExecutor = Pick<WaiaPostgresDb, "select" | "insert">;
type PgPaymentAddressProjectionExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "delete">;
type PgPaymentWalletExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

export function createSqlitePaymentAddressEventsRepository(
  db: WaiaDb,
): PaymentAddressEventsRepository {
  return {
    insertEvent: async (context, input) => insertPaymentAddressEventSqlite(db, context, input),
    listEvents: async (context, query) => listPaymentAddressEventsSqlite(db, context, query),
    listEventsForAddress: async (context, addressId) =>
      listPaymentAddressEventsForAddressSqlite(db, context, addressId),
  };
}

export function createPostgresPaymentAddressEventsRepository(
  ex: PgPaymentAddressEventsExecutor,
): PaymentAddressEventsRepository {
  return {
    insertEvent: (context, input) => insertPaymentAddressEventPostgres(ex, context, input),
    listEvents: (context, query) => listPaymentAddressEventsPostgres(ex, context, query),
    listEventsForAddress: (context, addressId) =>
      listPaymentAddressEventsForAddressPostgres(ex, context, addressId),
  };
}

export function createSqlitePaymentAddressProjectionRepository(
  db: WaiaDb,
): PaymentAddressProjectionRepository {
  return {
    upsertProjection: async (context, projection) =>
      upsertPaymentAddressProjectionSqlite(db, context, projection),
    getByAddressId: async (context, addressId) =>
      getPaymentAddressProjectionByIdSqlite(db, context, addressId),
    getByNetworkAddress: async (context, network, address) =>
      getPaymentAddressProjectionByNetworkAddressSqlite(db, context, network, address),
    findActiveBySubject: async (context, subjectModule, subjectRef) =>
      findActivePaymentAddressBySubjectSqlite(db, context, subjectModule, subjectRef),
    listAddresses: async (context, query) =>
      listPaymentAddressProjectionsSqlite(db, context, query),
    deleteAllForOrg: async (context) => deleteAllPaymentAddressProjectionsForOrgSqlite(db, context),
    deleteByAddressId: async (context, addressId) =>
      deletePaymentAddressProjectionByIdSqlite(db, context, addressId),
  };
}

export function createPostgresPaymentAddressProjectionRepository(
  ex: PgPaymentAddressProjectionExecutor,
): PaymentAddressProjectionRepository {
  return {
    upsertProjection: (context, projection) =>
      upsertPaymentAddressProjectionPostgres(ex, context, projection),
    getByAddressId: (context, addressId) =>
      getPaymentAddressProjectionByIdPostgres(ex, context, addressId),
    getByNetworkAddress: (context, network, address) =>
      getPaymentAddressProjectionByNetworkAddressPostgres(ex, context, network, address),
    findActiveBySubject: (context, subjectModule, subjectRef) =>
      findActivePaymentAddressBySubjectPostgres(ex, context, subjectModule, subjectRef),
    listAddresses: (context, query) => listPaymentAddressProjectionsPostgres(ex, context, query),
    deleteAllForOrg: (context) => deleteAllPaymentAddressProjectionsForOrgPostgres(ex, context),
    deleteByAddressId: (context, addressId) =>
      deletePaymentAddressProjectionByIdPostgres(ex, context, addressId),
  };
}

export function createSqlitePaymentWalletRepository(db: WaiaDb): PaymentWalletRepository {
  return {
    createWallet: async (context, input) => insertPaymentWalletSqlite(db, context, input),
    getWalletById: async (context, walletId) => getPaymentWalletByIdSqlite(db, context, walletId),
  };
}

export function createPostgresPaymentWalletRepository(
  ex: PgPaymentWalletExecutor,
): PaymentWalletRepository {
  return {
    createWallet: (context, input) => insertPaymentWalletPostgres(ex, context, input),
    getWalletById: (context, walletId) => getPaymentWalletByIdPostgres(ex, context, walletId),
  };
}

export {
  deleteAllPaymentAddressProjectionsForOrgSqlite,
  deletePaymentAddressProjectionByIdSqlite,
  findActivePaymentAddressBySubjectSqlite,
  getPaymentAddressProjectionByIdSqlite,
  getPaymentAddressProjectionByNetworkAddressSqlite,
  insertPaymentAddressEventSqlite,
  insertPaymentWalletSqlite,
  listPaymentAddressEventsForAddressSqlite,
  listPaymentAddressEventsSqlite,
  listPaymentAddressProjectionsSqlite,
  upsertPaymentAddressProjectionSqlite,
};
