import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { InvoiceIssuanceRepository } from "@/lib/trader/billing/invoice-issuance-repository.types";
import {
  executeInvoiceIssuanceAtomicPostgres,
  executeInvoiceIssuanceAtomicPostgresTx,
} from "@/lib/trader/billing/invoice-issuance-repository-postgres";
import { executeInvoiceIssuanceAtomicSqlite } from "@/lib/trader/billing/invoice-issuance-repository-sqlite";

type PgIssuanceExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update">;

export function createSqliteInvoiceIssuanceRepository(db: WaiaDb): InvoiceIssuanceRepository {
  return {
    executeAtomicIssuance: (context, input) =>
      executeInvoiceIssuanceAtomicSqlite(db, context, input),
  };
}

export function createPostgresInvoiceIssuanceRepository(
  ex: PgIssuanceExecutor,
  db?: WaiaPostgresDb,
): InvoiceIssuanceRepository {
  return {
    executeAtomicIssuance: (context, input) => {
      if (db) {
        return executeInvoiceIssuanceAtomicPostgresTx(db, context, input);
      }
      return executeInvoiceIssuanceAtomicPostgres(ex, context, input);
    },
  };
}

export {
  executeInvoiceIssuanceAtomicPostgres,
  executeInvoiceIssuanceAtomicPostgresTx,
  executeInvoiceIssuanceAtomicSqlite,
};
