/**
 * WAIA Core M1 hardening — Postgres runtime parity + audit immutability + RLS alignment.
 *
 * Opt-in: WAIA_PG_INTEGRATION=1 + DATABASE_URL_POSTGRES. Requires migrated Postgres
 * (incl. 0003_waia_core_m1 + 0004_audit_logs_rls) and the auth prelude (auth.users stub).
 *
 * Covers the findings the M1 audit flagged as SQLite-only:
 *   - provisioning + backfill (idempotent)
 *   - permissions (cross-org isolation)
 *   - entitlements (shadow mode)
 *   - audit read (admin-only) + write
 *   - real append-only enforcement (UPDATE/DELETE rejected by DB trigger)
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import postgres from "postgres";

import { getPostgresDrizzle, resetPostgresSingletonForTests } from "@/db/postgres-client";
import * as pgSchema from "@/db/schema.postgres";
import { backfillCoreForAllUsersPostgres } from "@/lib/waia-core/backfill/postgres";
import { listAuditLogsForAdminPostgres } from "@/lib/waia-core/audit/read";
import { writeAuditLogPostgres } from "@/lib/waia-core/audit/write";
import { checkEntitlementPostgres } from "@/lib/waia-core/entitlements/resolve";
import { resolvePermissionPostgres } from "@/lib/waia-core/permissions/resolve";
import {
  getProfileForUserPostgres,
  updateProfileForUserPostgres,
} from "@/lib/waia-core/profiles/postgres";
import { ensureUserCoreSeedPostgres } from "@/lib/waia-core/provisioning/postgres";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";

const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();

const USER_A = "00000000-0000-4000-8000-00000000c0e1";
const USER_B = "00000000-0000-4000-8000-00000000c0e2";
const ADMIN = "00000000-0000-4000-8000-00000000c0e3";
const ALL_IDS = [USER_A, USER_B, ADMIN];

describe.skipIf(!integrationEnabled || !url)("postgres WAIA Core parity (M1 hardening)", () => {
  let orgA: string;
  let orgB: string;

  async function cleanup(): Promise<void> {
    const sql = postgres(url!, { max: 1 });
    try {
      for (const uid of ALL_IDS) {
        const orgId = personalOrganizationIdFromUserId(uid);
        await sql.unsafe(`DELETE FROM organization_entitlements WHERE organization_id = $1`, [
          orgId,
        ]);
        await sql.unsafe(`DELETE FROM organization_subscriptions WHERE organization_id = $1`, [
          orgId,
        ]);
        await sql.unsafe(`DELETE FROM organization_members WHERE organization_id = $1`, [orgId]);
        // audit_logs is append-only; clear FK ref then remove org-scoped rows directly via owner bypass.
        await sql.unsafe(`ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_block_delete`);
        await sql.unsafe(`DELETE FROM audit_logs WHERE organization_id = $1`, [orgId]);
        await sql.unsafe(`ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_block_delete`);
        await sql.unsafe(`DELETE FROM organizations WHERE id = $1`, [orgId]);
        await sql.unsafe(`DELETE FROM user_platform_roles WHERE user_id = $1`, [uid]);
        await sql.unsafe(`DELETE FROM profiles WHERE user_id = $1`, [uid]);
        await sql.unsafe(`DELETE FROM users WHERE id = $1`, [uid]);
        await sql.unsafe(`DELETE FROM auth.users WHERE id = $1`, [uid]);
      }
    } finally {
      await sql.end({ timeout: 5 });
    }
  }

  beforeAll(async () => {
    await cleanup();
    const sql = postgres(url!, { max: 1 });
    try {
      for (const uid of ALL_IDS) {
        await sql.unsafe(`INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [
          uid,
        ]);
      }
    } finally {
      await sql.end({ timeout: 5 });
    }

    const db = getPostgresDrizzle();
    await db.insert(pgSchema.users).values([
      { id: USER_A, identityLabel: "User A", email: "core-a@waia.invalid", passwordHash: null },
      { id: USER_B, identityLabel: "User B", email: "core-b@waia.invalid", passwordHash: null },
      { id: ADMIN, identityLabel: "Admin", email: "core-admin@waia.invalid", passwordHash: null },
    ]);

    orgA = await ensureUserCoreSeedPostgres(db, { userId: USER_A, displayName: "User A" });
    orgB = await ensureUserCoreSeedPostgres(db, { userId: USER_B, displayName: "User B" });
    await ensureUserCoreSeedPostgres(db, { userId: ADMIN, displayName: "Admin" });

    await db
      .update(pgSchema.userPlatformRoles)
      .set({ role: "admin" })
      .where(eq(pgSchema.userPlatformRoles.userId, ADMIN));
  });

  afterAll(async () => {
    await cleanup();
    await resetPostgresSingletonForTests();
  });

  it("provisioning created distinct personal orgs with owner membership", async () => {
    const db = getPostgresDrizzle();
    expect(orgA).not.toBe(orgB);

    const memberA = await db
      .select()
      .from(pgSchema.organizationMembers)
      .where(
        and(
          eq(pgSchema.organizationMembers.organizationId, orgA),
          eq(pgSchema.organizationMembers.userId, USER_A),
        ),
      );
    expect(memberA[0]?.memberRole).toBe("owner");
  });

  it("backfill is idempotent and safe to re-run", async () => {
    const db = getPostgresDrizzle();
    const processed = await backfillCoreForAllUsersPostgres(db);
    expect(processed).toBeGreaterThanOrEqual(ALL_IDS.length);

    const orgs = await db
      .select()
      .from(pgSchema.organizations)
      .where(eq(pgSchema.organizations.ownerUserId, USER_A));
    expect(orgs.length).toBe(1);
  });

  it("permissions: user A cannot resolve org B member permissions", async () => {
    const db = getPostgresDrizzle();
    const result = await resolvePermissionPostgres(db, {
      userId: USER_A,
      organizationId: orgB,
      permission: "org.member.read",
    });
    expect(result.allowed).toBe(false);
  });

  it("entitlements: shadow mode allows twin for personal orgs", async () => {
    process.env.WAIA_CORE_ENFORCEMENT = "0";
    process.env.WAIA_CORE_SHADOW = "1";
    const db = getPostgresDrizzle();
    const a = await checkEntitlementPostgres(db, {
      organizationId: orgA,
      entitlementKey: "twin",
      actorUserId: USER_A,
    });
    expect(a.allowed).toBe(true);
  });

  it("audit: admin can read, regular user cannot", async () => {
    const db = getPostgresDrizzle();
    const auditId = await writeAuditLogPostgres(db, {
      actorType: "user",
      actorId: USER_A,
      action: "test.pg.action",
      entityType: "fixture",
      entityId: "1",
      organizationId: orgA,
      metadata: { ok: true },
    });

    const adminRows = await listAuditLogsForAdminPostgres(db, { adminUserId: ADMIN, limit: 50 });
    expect(adminRows.some((r) => r.id === auditId)).toBe(true);

    const userRows = await listAuditLogsForAdminPostgres(db, { adminUserId: USER_A, limit: 50 });
    expect(userRows.length).toBe(0);
  });

  it("audit logs are append-only — real UPDATE rejected by DB trigger", async () => {
    const db = getPostgresDrizzle();
    const auditId = await writeAuditLogPostgres(db, {
      actorType: "system",
      action: "immutable.pg.update",
      entityType: "fixture",
      organizationId: orgA,
    });

    await expect(
      db
        .update(pgSchema.auditLogs)
        .set({ action: "tampered" })
        .where(eq(pgSchema.auditLogs.id, auditId)),
    ).rejects.toThrow(/append-only/i);
  });

  it("audit logs are append-only — real DELETE rejected by DB trigger", async () => {
    const db = getPostgresDrizzle();
    const auditId = await writeAuditLogPostgres(db, {
      actorType: "system",
      action: "immutable.pg.delete",
      entityType: "fixture",
      organizationId: orgA,
    });

    await expect(
      db.delete(pgSchema.auditLogs).where(eq(pgSchema.auditLogs.id, auditId)),
    ).rejects.toThrow(/append-only/i);
  });

  it("profiles: read + update round-trip", async () => {
    const db = getPostgresDrizzle();
    const before = await getProfileForUserPostgres(db, USER_A);
    expect(before?.userId).toBe(USER_A);

    const updated = await updateProfileForUserPostgres(db, USER_A, { locale: "de" });
    expect(updated?.locale).toBe("de");
  });
});
