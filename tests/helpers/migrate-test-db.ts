import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";

import { getDb, resetWaiaSqliteSingleton } from "@/db/client";

/**
 * Applies SQL migrations using the production `getDb()` connection (requires DATABASE_URL).
 */
export function migrateDatabaseFromEnv(): void {
  resetWaiaSqliteSingleton();
  const db = getDb();
  migrate(db, { migrationsFolder: path.join(process.cwd(), "db/migrations") });
}
