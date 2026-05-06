/**
 * DEE-64A: Validates postgres.js + drizzle-orm/postgres-js against local Docker Postgres
 * (DATABASE_URL_POSTGRES). Does not touch app runtime or db/client.ts.
 */

import { eq, sql } from "drizzle-orm";

import {
  getPostgresDrizzle,
  getPostgresSql,
  resetPostgresSingletonForTests,
} from "@/db/postgres-client";
import * as pgSchema from "@/db/schema.postgres";

const SMOKE_ID = "00000000-0000-4000-8000-00000000640a";
const SMOKE_EMAIL = "dee64a-smoke@waia.invalid";
const SMOKE_LABEL = "DEE-64A smoke";

function assertLocalPostgres(connectionString: string): void {
  let host: string;
  try {
    const normalized = connectionString.replace(/^postgresql:\/\//i, "http://");
    host = new URL(normalized).hostname;
  } catch {
    throw new Error("DATABASE_URL_POSTGRES is not a valid URL.");
  }
  const allowed = host === "127.0.0.1" || host === "localhost" || host === "::1";
  if (!allowed) {
    throw new Error(
      `host "${host}" is not allowed — use local Docker Postgres (127.0.0.1 / localhost only). Never waia-prod.`,
    );
  }
}

async function cleanup(client: ReturnType<typeof getPostgresSql>): Promise<void> {
  await client.unsafe(`DELETE FROM public.users WHERE id = $1`, [SMOKE_ID]);
  await client.unsafe(`DELETE FROM auth.users WHERE id = $1`, [SMOKE_ID]);
}

async function main(): Promise<void> {
  const databaseUrlPostgres = process.env.DATABASE_URL_POSTGRES?.trim();
  if (!databaseUrlPostgres) {
    throw new Error("DATABASE_URL_POSTGRES is not set.");
  }

  assertLocalPostgres(databaseUrlPostgres);

  const db = getPostgresDrizzle();
  const client = getPostgresSql();

  try {
    await cleanup(client);

    await db.execute(sql`INSERT INTO auth.users (id) VALUES (${SMOKE_ID})`);

    await db.insert(pgSchema.users).values({
      id: SMOKE_ID,
      identityLabel: SMOKE_LABEL,
      email: SMOKE_EMAIL,
      passwordHash: null,
    });

    const rows = await db.select().from(pgSchema.users).where(eq(pgSchema.users.id, SMOKE_ID)).limit(1);

    if (rows.length !== 1 || rows[0]?.email !== SMOKE_EMAIL) {
      throw new Error("select did not return the inserted public.users row.");
    }

    await db.delete(pgSchema.users).where(eq(pgSchema.users.id, SMOKE_ID));
    await db.execute(sql`DELETE FROM auth.users WHERE id = ${SMOKE_ID}`);

    console.log("[DEE-64A] OK: drizzle + postgres-js + schema.postgres (insert/select/delete, FK-safe).");
  } catch (e) {
    try {
      await cleanup(client);
    } catch {
      /* best-effort */
    }
    throw e;
  } finally {
    await resetPostgresSingletonForTests();
  }
}

main().catch((err: unknown) => {
  console.error("[DEE-64A] Fail:", err instanceof Error ? err.message : err);
  process.exit(1);
});
