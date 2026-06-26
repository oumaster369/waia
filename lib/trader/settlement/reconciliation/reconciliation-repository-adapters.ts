import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { createPostgresReconciliationCaseRepository } from "@/lib/trader/settlement/reconciliation/reconciliation-case-repository-postgres";
import { createSqliteReconciliationCaseRepository } from "@/lib/trader/settlement/reconciliation/reconciliation-case-repository-sqlite";

export function createPostgresReconciliationRepositoryAdapters(
  ex: Pick<WaiaPostgresDb, "select" | "insert">,
) {
  return {
    caseRepository: createPostgresReconciliationCaseRepository(ex),
  };
}

export function createSqliteReconciliationRepositoryAdapters(
  ex: Pick<WaiaDb, "select" | "insert">,
) {
  return {
    caseRepository: createSqliteReconciliationCaseRepository(ex),
  };
}
