/**
 * DEE-75: Postgres `public.users` sync from Supabase Auth ids — `syncAppUserRowFromSupabaseAuthPostgres`
 * and first dashboard readiness read (FK chain to twin_profiles).
 *
 * Opt-in: WAIA_PG_INTEGRATION=1 + DATABASE_URL_POSTGRES. Requires migrated Postgres + auth prelude (auth.users stub).
 */

import { describe, expect, it, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import postgres from "postgres";

import { getPostgresDrizzle, resetPostgresSingletonForTests } from "@/db/postgres-client";
import * as pgSchema from "@/db/schema.postgres";
import {
  createPostgresTwinPersistence,
  syncAppUserRowFromSupabaseAuthPostgres,
} from "@/lib/persistence/postgres/twin-persistence";

const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();

describe.skipIf(!integrationEnabled || !url)("postgres Supabase app-user sync (DEE-75)", () => {
  const testUserId = "00000000-0000-4000-8000-00000000de75";
  const testEmail = "dee75-sync@waia.invalid";
  const collisionUserId = "00000000-0000-4000-8000-00000000de76";

  afterEach(async () => {
    if (!url) return;
    const sql = postgres(url, { max: 1 });
    try {
      for (const uid of [testUserId, collisionUserId]) {
        await sql.unsafe(
          `DELETE FROM twin_dialogue_turns WHERE twin_profile_id IN (SELECT id FROM twin_profiles WHERE user_id = $1)`,
          [uid],
        );
        await sql.unsafe(
          `DELETE FROM twin_readiness_state WHERE twin_profile_id IN (SELECT id FROM twin_profiles WHERE user_id = $1)`,
          [uid],
        );
        await sql.unsafe(`DELETE FROM twin_profiles WHERE user_id = $1`, [uid]);
        await sql.unsafe(`DELETE FROM users WHERE id = $1`, [uid]);
        await sql.unsafe(`DELETE FROM auth.users WHERE id = $1`, [uid]);
      }
    } finally {
      await sql.end({ timeout: 5 });
    }
    await resetPostgresSingletonForTests();
  });

  async function seedAuthUser(id: string): Promise<void> {
    const sql = postgres(url!, { max: 1 });
    try {
      await sql.unsafe(`INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [id]);
    } finally {
      await sql.end({ timeout: 5 });
    }
  }

  it("sync inserts public.users + twin seed; readiness load succeeds", async () => {
    await seedAuthUser(testUserId);

    const db = getPostgresDrizzle();
    await syncAppUserRowFromSupabaseAuthPostgres(db, {
      supabaseUserId: testUserId,
      email: testEmail,
      identityLabel: "dee75",
    });

    const row = await db.select({ id: pgSchema.users.id }).from(pgSchema.users).where(eq(pgSchema.users.id, testUserId));
    expect(row.length).toBe(1);

    const p = createPostgresTwinPersistence(db);
    const payload = await p.loadDashboardReadinessPayloadFromDb(testUserId);
    expect(payload.identityLabel).toBe("dee75");
  });

  it("email collision: existing different id does not insert second user", async () => {
    await seedAuthUser(testUserId);
    await seedAuthUser(collisionUserId);

    const db = getPostgresDrizzle();
    await syncAppUserRowFromSupabaseAuthPostgres(db, {
      supabaseUserId: testUserId,
      email: testEmail,
      identityLabel: "first",
    });

    await syncAppUserRowFromSupabaseAuthPostgres(db, {
      supabaseUserId: collisionUserId,
      email: testEmail,
      identityLabel: "second",
    });

    const collisionRow = await db
      .select({ id: pgSchema.users.id })
      .from(pgSchema.users)
      .where(eq(pgSchema.users.id, collisionUserId));
    expect(collisionRow.length).toBe(0);
  });

  it("idempotent second sync does not error", async () => {
    await seedAuthUser(testUserId);
    const db = getPostgresDrizzle();
    await syncAppUserRowFromSupabaseAuthPostgres(db, {
      supabaseUserId: testUserId,
      email: testEmail,
      identityLabel: "a",
    });
    await syncAppUserRowFromSupabaseAuthPostgres(db, {
      supabaseUserId: testUserId,
      email: testEmail,
      identityLabel: "b",
    });
    const p = createPostgresTwinPersistence(db);
    const payload = await p.loadDashboardReadinessPayloadFromDb(testUserId);
    /** Matches SQLite: existing user by id runs twin seed only — does not overwrite identity label. */
    expect(payload.identityLabel).toBe("a");
  });
});
