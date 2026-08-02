import "server-only";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import * as schema from "@/db/schema";
import fs from "node:fs";
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
    if (fp !== ":memory:") {
      applyResearchReplaySqlitePragmas(sqlite);
    }
    globalStore.__waia_sqlite__ = sqlite;
  }
  return drizzle(globalStore.__waia_sqlite__, { schema });
}

/**
 * Session SQLite tuning for FHV/research replay hot paths.
 * Checkpoint online backup + fsync remains the durability boundary; NORMAL synchronous
 * between checkpoints is acceptable per FHV execution protocol.
 */
export function applyResearchReplaySqlitePragmas(sqlite: Database.Database): void {
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("cache_size = -64000");
  sqlite.pragma("temp_store = MEMORY");
  sqlite.pragma("mmap_size = 268435456");
}

/** Returns the underlying better-sqlite3 handle from the singleton (call `getDb()` first). */
export function getRawSqliteDatabase(): Database.Database {
  if (!globalStore.__waia_sqlite__) {
    throw new Error("[waia] SQLite singleton not initialized; call getDb() first");
  }
  return globalStore.__waia_sqlite__;
}

/** Online SQLite backup with post-backup integrity check and fsync. */
export async function backupSqliteDatabaseToFile(
  destPath: string,
): Promise<{ bytes: number; integrityCheck: string }> {
  const source = getRawSqliteDatabase();
  const destDir = path.dirname(destPath);
  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true });
  }

  await source.backup(destPath);

  const backupDb = new Database(destPath, { readonly: true });
  let integrityCheck: string;
  try {
    integrityCheck = backupDb.pragma("integrity_check", { simple: true }) as string;
  } finally {
    backupDb.close();
  }

  const fd = fs.openSync(destPath, "r");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  return { bytes: fs.statSync(destPath).size, integrityCheck };
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
