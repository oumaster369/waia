import { sql } from "drizzle-orm";

import type { WaiaRuntimeDb } from "@/db/waia-runtime-db";

const TTL_MS = 60_000;

let cached: { at: number; present: boolean } | null = null;

export function resetAdminConsoleSchemaProbeForTests(): void {
  cached = null;
}

function rowsOf(result: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return rows as Record<string, unknown>[];
  }
  return [];
}

export async function probeAdminConsoleSchema(
  runtime: WaiaRuntimeDb,
  now = Date.now(),
): Promise<boolean> {
  if (runtime.kind !== "postgres") return false;
  if (cached && now - cached.at < TTL_MS) return cached.present;
  try {
    const result = await runtime.db.execute(
      sql`SELECT to_regclass('public.trader_admin_change_log') IS NOT NULL AS present`,
    );
    const present = rowsOf(result)[0]?.present === true;
    cached = { at: now, present };
    return present;
  } catch {
    cached = { at: now, present: false };
    return false;
  }
}
