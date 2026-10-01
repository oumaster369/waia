import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { is } from "drizzle-orm";
import { PgTransaction } from "drizzle-orm/pg-core";
import { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";

export const RESEARCH_ROOT_DATABASE_REQUIRED = "RESEARCH_ROOT_DATABASE_REQUIRED";

/** A Drizzle transaction's transaction() creates a savepoint, not a durable
 * commit. Research registration and one-shot disclosure must own root commits.
 * This checks the actual adapter; a structural transaction-shaped object is not
 * enough. It is not a database permission or scientific admission check. */
export function assertResearchRootPostgresDbV1(value: unknown): asserts value is WaiaPostgresDb {
  if (!is(value, PostgresJsDatabase) || is(value, PgTransaction)) {
    throw new Error(RESEARCH_ROOT_DATABASE_REQUIRED);
  }
}
