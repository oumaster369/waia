import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import {
  getCredentialRowByIdPostgres,
  insertCredentialRowPostgres,
  listCredentialRowsForOrgPostgres,
  revokeCredentialRowPostgres,
} from "@/lib/trader/credentials/repository-postgres";
import {
  getCredentialRowByIdSqlite,
  insertCredentialRowSqlite,
  listCredentialRowsForOrgSqlite,
  revokeCredentialRowSqlite,
} from "@/lib/trader/credentials/repository-sqlite";
import type { ExchangeCredentialRepository } from "@/lib/trader/credentials/types";

type PgCredentialExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update">;

export function createSqliteExchangeCredentialRepository(db: WaiaDb): ExchangeCredentialRepository {
  return {
    insertCredentialRow: (context, input) => insertCredentialRowSqlite(db, context, input),
    getCredentialRowById: (context, credentialId) =>
      getCredentialRowByIdSqlite(db, context, credentialId),
    listCredentialRowsForOrg: (context) => listCredentialRowsForOrgSqlite(db, context),
    revokeCredentialRow: (context, credentialId) =>
      revokeCredentialRowSqlite(db, context, credentialId),
  };
}

export function createPostgresExchangeCredentialRepository(
  ex: PgCredentialExecutor,
): ExchangeCredentialRepository {
  return {
    insertCredentialRow: (context, input) => insertCredentialRowPostgres(ex, context, input),
    getCredentialRowById: (context, credentialId) =>
      getCredentialRowByIdPostgres(ex, context, credentialId),
    listCredentialRowsForOrg: (context) => listCredentialRowsForOrgPostgres(ex, context),
    revokeCredentialRow: (context, credentialId) =>
      revokeCredentialRowPostgres(ex, context, credentialId),
  };
}
