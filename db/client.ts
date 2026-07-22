import "server-only";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import * as schema from "@/db/schema";
import path from "node:path";
import { existsSync, mkdirSync } from "node:fs";

/** Resolve SQLite path; supports `file:./relative`, absolute paths, or `:memory:`. */
export function resolveSqliteDatabasePath(url = process.env.DATABASE_URL): string {
  const raw = url ?? "file:./.data/waia.db";
  if (raw === ":memory:") {
    return ":memory:";
  }
  const stripped = raw.startsWith("file:") ? raw.slice("file:".length) : raw;
  if (stripped === ":memory:") {
    return ":memory:";
  }
  return path.isAbsolute(stripped)
    ? stripped
    : path.resolve(/* turbopackIgnore: true */ process.cwd(), stripped);
}

const globalStore = globalThis as typeof globalThis & { __waia_sqlite__?: Database.Database };

export function getDb() {
  if (!globalStore.__waia_sqlite__) {
    const fp = resolveSqliteDatabasePath();
    if (fp !== ":memory:") {
      const dir = path.dirname(fp);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }
    const sqlite = new Database(fp);
    sqlite.pragma("foreign_keys = ON");
    sqlite.pragma("journal_mode = WAL");
    globalStore.__waia_sqlite__ = sqlite;
  }
  return drizzle(globalStore.__waia_sqlite__, { schema });
}

/** Testing only: clears cached connection so DATABASE_URL swaps take effect. */
export function resetWaiaSqliteSingleton(): void {
  try {
    globalStore.__waia_sqlite__?.close();
  } catch {
    /* ignore close errors during parallel teardown */
  }
  globalStore.__waia_sqlite__ = undefined;
}
