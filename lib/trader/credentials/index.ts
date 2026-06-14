import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

export type {
  ExchangeCredentialRepository,
  ExchangeCredentialRow,
  ExchangeCredentialStatus,
  InsertExchangeCredentialRowInput,
} from "@/lib/trader/credentials/types";
export {
  getCredentialRowByIdPostgres,
  insertCredentialRowPostgres,
  listCredentialRowsForOrgPostgres,
  revokeCredentialRowPostgres,
} from "@/lib/trader/credentials/repository-postgres";
export {
  getCredentialRowByIdSqlite,
  insertCredentialRowSqlite,
  listCredentialRowsForOrgSqlite,
  revokeCredentialRowSqlite,
} from "@/lib/trader/credentials/repository-sqlite";
