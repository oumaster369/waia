import { sql } from "drizzle-orm";

import type { WaiaRuntimeDb } from "@/db/waia-runtime-db";

const TTL_MS = 60_000;
const TABLE_NAME = /^[a-z][a-z0-9_]*$/;

const cache = new Map<string, { at: number; present: boolean }>();

export function resetAdminConsoleSchemaProbeForTests(): void {
  cache.clear();
}

function rowsOf(result: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return rows as Record<string, unknown>[];
  }
  return [];
}

function cacheKey(tables: readonly string[]): string {
  return [...new Set(tables)].sort().join("\n");
}

function presentValue(value: unknown): boolean {
  return value === true;
}

/**
 * True when every named public table exists.
 * The cache key is the table set, so one handler's miss does not hide another's tables.
 */
export async function probeAdminConsoleSchema(
  runtime: WaiaRuntimeDb,
  tables: readonly string[],
  now = Date.now(),
): Promise<boolean> {
  if (runtime.kind !== "postgres") return false;
  const names = [...new Set(tables)];
  const key = cacheKey(names);
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.present;
  if (names.length === 0) {
    cache.set(key, { at: now, present: true });
    return true;
  }
  if (names.some((name) => !TABLE_NAME.test(name))) {
    cache.set(key, { at: now, present: false });
    return false;
  }
  try {
    const predicate = sql.join(
      names.map((table) => sql`to_regclass(${`public.${table}`}) IS NOT NULL`),
      sql` AND `,
    );
    const result = await runtime.db.execute(sql`SELECT (${predicate}) AS present`);
    const present = presentValue(rowsOf(result)[0]?.present);
    cache.set(key, { at: now, present });
    return present;
  } catch {
    cache.set(key, { at: now, present: false });
    return false;
  }
}
