import { sql } from "drizzle-orm";

import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { isUniqueConstraintError } from "@/lib/trader/execution/order-repository.types";

type PgSavepointExecutor = Pick<WaiaPostgresDb, "execute">;

let savepointCounter = 0;

function nextSavepointName(prefix: string): string {
  savepointCounter += 1;
  return `waia_wp13_${prefix}_${savepointCounter}`;
}

/**
 * Runs an INSERT inside a SAVEPOINT so a PostgreSQL 23505 does not abort the outer transaction.
 */
export async function runIdempotentInsertWithSavepoint(
  ex: PgSavepointExecutor,
  prefix: string,
  insert: () => Promise<void>,
): Promise<"inserted" | "unique_violation"> {
  const savepoint = nextSavepointName(prefix);
  await ex.execute(sql.raw(`SAVEPOINT ${savepoint}`));
  try {
    await insert();
    await ex.execute(sql.raw(`RELEASE SAVEPOINT ${savepoint}`));
    return "inserted";
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }
    await ex.execute(sql.raw(`ROLLBACK TO SAVEPOINT ${savepoint}`));
    return "unique_violation";
  }
}
