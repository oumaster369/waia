/**
 * WAIA Core M1 production backfill (DEE / WAIA Core Uplift).
 *
 * Seeds existing users with Core records (profile, personal organization, owner
 * membership, baseline `twin` subscription + entitlement). Idempotent and safe to
 * re-run — provisioning performs existence checks before each insert.
 *
 * Usage:
 *   # SQLite (default backend) — requires DATABASE_URL
 *   pnpm waia:core:backfill
 *   pnpm waia:core:backfill --dry-run
 *
 *   # Postgres — requires DATABASE_URL_POSTGRES
 *   pnpm waia:core:backfill --backend=postgres
 *   pnpm waia:core:backfill --backend=postgres --dry-run
 *
 * Aligns with ADR-0002 (staged Postgres rollout) — backend is explicit, never inferred.
 */

import { backfillCoreForAllUsersSqlite } from "@/lib/waia-core/backfill/sqlite";
import { backfillCoreForAllUsersPostgres } from "@/lib/waia-core/backfill/postgres";

type Backend = "sqlite" | "postgres";

function parseArgs(argv: string[]): { backend: Backend; dryRun: boolean } {
  const backendArg = argv.find((a) => a.startsWith("--backend="))?.split("=")[1];
  const backend: Backend = backendArg === "postgres" ? "postgres" : "sqlite";
  const dryRun = argv.includes("--dry-run");
  return { backend, dryRun };
}

async function backfillSqlite(dryRun: boolean): Promise<number> {
  const { getDb } = await import("@/db/client");
  const db = getDb();

  if (dryRun) {
    const { users } = await import("@/db/schema");
    return db.select({ id: users.id }).from(users).all().length;
  }
  return backfillCoreForAllUsersSqlite(db);
}

async function backfillPostgres(dryRun: boolean): Promise<number> {
  const { withWaiaPostgresClient } = await import("@/db/postgres-client");
  return withWaiaPostgresClient(async (_sql, db) => {
    if (dryRun) {
      const pgSchema = await import("@/db/schema.postgres");
      const rows = await db.select({ id: pgSchema.users.id }).from(pgSchema.users);
      return rows.length;
    }
    return backfillCoreForAllUsersPostgres(db);
  });
}

async function main(): Promise<void> {
  const { backend, dryRun } = parseArgs(process.argv.slice(2));
  const mode = dryRun ? "DRY-RUN (no writes)" : "APPLY";
  console.log(`[waia-core:backfill] backend=${backend} mode=${mode}`);

  const processed =
    backend === "postgres" ? await backfillPostgres(dryRun) : await backfillSqlite(dryRun);

  if (dryRun) {
    console.log(
      `[waia-core:backfill] would process ${processed} user(s). Re-run without --dry-run to apply.`,
    );
  } else {
    console.log(
      `[waia-core:backfill] OK: ensured Core seed for ${processed} user(s) (idempotent).`,
    );
  }
}

main().catch((err: unknown) => {
  console.error("[waia-core:backfill] FAIL:", err instanceof Error ? err.message : err);
  process.exit(1);
});
