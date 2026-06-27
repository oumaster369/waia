/**
 * DEE-232 / DEE-225 R1: Postgres twin seed must commit when Core provisioning fails.
 *
 * Opt-in: WAIA_PG_INTEGRATION=1 + DATABASE_URL_POSTGRES.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";

import { getPostgresDrizzle, resetPostgresSingletonForTests } from "@/db/postgres-client";
import * as pgSchema from "@/db/schema.postgres";
import * as coreProvisioning from "@/lib/waia-core/provisioning/postgres";
import { createPostgresTwinPersistence } from "@/lib/persistence/postgres/twin-persistence";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";

const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();

describe.skipIf(!integrationEnabled || !url)("postgres core seed fail-open (DEE-232)", () => {
  const testUserId = "00000000-0000-4000-8000-00000000d232";

  afterEach(async () => {
    vi.restoreAllMocks();
    if (!url) return;
    const orgId = personalOrganizationIdFromUserId(testUserId);
    const sql = postgres(url, { max: 1 });
    try {
      await sql.unsafe(`DELETE FROM organization_entitlements WHERE organization_id = $1`, [orgId]);
      await sql.unsafe(`DELETE FROM organization_subscriptions WHERE organization_id = $1`, [
        orgId,
      ]);
      await sql.unsafe(`DELETE FROM organization_members WHERE organization_id = $1`, [orgId]);
      await sql.unsafe(`DELETE FROM organizations WHERE id = $1`, [orgId]);
      await sql.unsafe(`DELETE FROM user_platform_roles WHERE user_id = $1`, [testUserId]);
      await sql.unsafe(`DELETE FROM profiles WHERE user_id = $1`, [testUserId]);
      await sql.unsafe(
        `DELETE FROM twin_readiness_state WHERE twin_profile_id IN (SELECT id FROM twin_profiles WHERE user_id = $1)`,
        [testUserId],
      );
      await sql.unsafe(`DELETE FROM twin_profiles WHERE user_id = $1`, [testUserId]);
      await sql.unsafe(`DELETE FROM users WHERE id = $1`, [testUserId]);
      await sql.unsafe(`DELETE FROM auth.users WHERE id = $1`, [testUserId]);
    } finally {
      await sql.end({ timeout: 5 });
    }
    await resetPostgresSingletonForTests();
  });

  it("ensureUserTwinSeed commits twin rows when ensureUserCoreSeedPostgres throws", async () => {
    const authSql = postgres(url!, { max: 1 });
    try {
      await authSql.unsafe(`INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [
        testUserId,
      ]);
    } finally {
      await authSql.end({ timeout: 5 });
    }

    const db = getPostgresDrizzle();
    await db.insert(pgSchema.users).values({
      id: testUserId,
      identityLabel: "DEE-232 fail-open",
      email: "dee232-fail-open@waia.invalid",
      passwordHash: null,
    });

    const coreSpy = vi
      .spyOn(coreProvisioning, "ensureUserCoreSeedPostgres")
      .mockRejectedValueOnce(new Error("simulated core seed failure"));

    const p = createPostgresTwinPersistence(db);
    const twinProfileId = await p.ensureUserTwinSeed(testUserId);

    expect(twinProfileId).toBeTruthy();
    expect(coreSpy).toHaveBeenCalledOnce();

    const verify = postgres(url!, { max: 1 });
    try {
      const twinRows = await verify<{ id: string }[]>`
        SELECT id FROM twin_profiles WHERE user_id = ${testUserId}
      `;
      expect(twinRows.length).toBe(1);
      expect(twinRows[0]?.id).toBe(twinProfileId);

      const readinessRows = await verify<{ twin_profile_id: string }[]>`
        SELECT twin_profile_id FROM twin_readiness_state WHERE twin_profile_id = ${twinProfileId}
      `;
      expect(readinessRows.length).toBe(1);

      const profileRows = await verify<{ user_id: string }[]>`
        SELECT user_id FROM profiles WHERE user_id = ${testUserId}
      `;
      expect(profileRows.length).toBe(0);
    } finally {
      await verify.end({ timeout: 5 });
    }
  });
});
