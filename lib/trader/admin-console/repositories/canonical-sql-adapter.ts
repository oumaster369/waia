import { sql, type SQL } from "drizzle-orm";
import type postgres from "postgres";
import type { AdminReadTx } from "./snapshot.postgres";

/** Internal canonical readers use PostgreSQL placeholders. Keep their reads on our snapshot.
 * Statement text is trusted source code; every value remains a bound parameter.
 * No begin member: the caller already owns REPEATABLE READ READ ONLY.
 */
export function canonicalSqlOnSnapshot(tx: AdminReadTx): Pick<postgres.Sql, "unsafe"> {
  const unsafe = async (statement: string, parameters: readonly unknown[] = []) => {
    const chunks: SQL[] = [];
    let start = 0;
    for (const match of statement.matchAll(/\$(\d+)/g)) {
      chunks.push(sql.raw(statement.slice(start, match.index)));
      const index = Number(match[1]) - 1;
      if (index < 0 || index >= parameters.length)
        throw new Error("CANONICAL_SQL_PARAMETER_MISSING");
      chunks.push(sql`${parameters[index]}`);
      start = match.index! + match[0].length;
    }
    chunks.push(sql.raw(statement.slice(start)));
    return tx.execute(sql.join(chunks, sql.raw("")));
  };
  return { unsafe: unsafe as unknown as postgres.Sql["unsafe"] };
}
