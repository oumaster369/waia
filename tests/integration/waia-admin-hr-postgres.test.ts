import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import {
  createPublicHrApplication,
  listHrApplications,
  mutateHrApplication,
} from "@/lib/waia-core/hr/service";
import { resolvePermissionPostgres } from "@/lib/waia-core/permissions/resolve";
import { ensureUserCoreSeedPostgres } from "@/lib/waia-core/provisioning/postgres";

const enabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();
const describePostgres = describe.skipIf(!enabled || !url);

const APPLICANT = "74700000-0000-4000-8000-000000000101";
const HR_ADMIN = "74700000-0000-4000-8000-000000000102";
const SUPER_ADMIN = "74700000-0000-4000-8000-000000000103";
const GRANT = "74700000-0000-4000-8000-000000000104";
const SUPER_GRANT = "74700000-0000-4000-8000-000000000105";

describePostgres("DEE-747 shared WAIA Admin and HR persistence", () => {
  let sqlClient: postgres.Sql;
  let db: WaiaPostgresDb;
  let hrOrgId: string;
  let applicationId = "";

  async function cleanup() {
    for (const command of [
      "ALTER TABLE hr_application_events DISABLE TRIGGER hr_application_event_delete_guard",
      "ALTER TABLE hr_team_applications DISABLE TRIGGER hr_team_application_delete_guard",
      "ALTER TABLE waia_admin_module_grants DISABLE TRIGGER waia_admin_grant_delete_guard",
      "ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_block_delete",
    ])
      await sqlClient.unsafe(command);
    try {
      await sqlClient`DELETE FROM hr_application_events WHERE application_id IN (
        SELECT id FROM hr_team_applications WHERE contact_email = 'dee-747-applicant@waia.invalid'
      )`;
      await sqlClient`DELETE FROM hr_team_applications WHERE contact_email = 'dee-747-applicant@waia.invalid'`;
      await sqlClient`DELETE FROM waia_admin_module_grants WHERE user_id IN (${HR_ADMIN}::uuid, ${SUPER_ADMIN}::uuid)`;
      await sqlClient`DELETE FROM audit_logs WHERE actor_id IN (${APPLICANT}, ${HR_ADMIN}, ${SUPER_ADMIN})
        OR (entity_type = 'hr_team_application' AND action LIKE 'hr.application.%')`;
      await sqlClient`DELETE FROM organization_members WHERE user_id IN (${APPLICANT}::uuid, ${HR_ADMIN}::uuid, ${SUPER_ADMIN}::uuid)`;
      await sqlClient`DELETE FROM organizations WHERE owner_user_id IN (${APPLICANT}::uuid, ${HR_ADMIN}::uuid, ${SUPER_ADMIN}::uuid)`;
      await sqlClient`DELETE FROM user_platform_roles WHERE user_id IN (${APPLICANT}::uuid, ${HR_ADMIN}::uuid, ${SUPER_ADMIN}::uuid)`;
      await sqlClient`DELETE FROM profiles WHERE user_id IN (${APPLICANT}::uuid, ${HR_ADMIN}::uuid, ${SUPER_ADMIN}::uuid)`;
      await sqlClient`DELETE FROM users WHERE id IN (${APPLICANT}::uuid, ${HR_ADMIN}::uuid, ${SUPER_ADMIN}::uuid)`;
      await sqlClient`DELETE FROM auth.users WHERE id IN (${APPLICANT}::uuid, ${HR_ADMIN}::uuid, ${SUPER_ADMIN}::uuid)`;
    } finally {
      for (const command of [
        "ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_block_delete",
        "ALTER TABLE waia_admin_module_grants ENABLE TRIGGER waia_admin_grant_delete_guard",
        "ALTER TABLE hr_team_applications ENABLE TRIGGER hr_team_application_delete_guard",
        "ALTER TABLE hr_application_events ENABLE TRIGGER hr_application_event_delete_guard",
      ])
        await sqlClient.unsafe(command);
    }
  }

  beforeAll(async () => {
    sqlClient = postgres(url!, { max: 4, prepare: false });
    db = drizzle(sqlClient, { schema: pgSchema }) as WaiaPostgresDb;
    await cleanup();
    for (const id of [APPLICANT, HR_ADMIN, SUPER_ADMIN]) {
      await sqlClient.unsafe("INSERT INTO auth.users (id) VALUES ($1::uuid)", [id]);
    }
    await db.insert(pgSchema.users).values([
      { id: APPLICANT, identityLabel: "Applicant", email: "dee-747-applicant@waia.invalid" },
      { id: HR_ADMIN, identityLabel: "HR admin", email: "dee-747-hr@waia.invalid" },
      { id: SUPER_ADMIN, identityLabel: "Super admin", email: "dee-747-super@waia.invalid" },
    ]);
    await ensureUserCoreSeedPostgres(db, { userId: APPLICANT, displayName: "Applicant" });
    hrOrgId = await ensureUserCoreSeedPostgres(db, { userId: HR_ADMIN, displayName: "HR admin" });
    await ensureUserCoreSeedPostgres(db, { userId: SUPER_ADMIN, displayName: "Super admin" });
    await db.insert(pgSchema.waiaAdminModuleGrants).values([
      {
        id: GRANT,
        userId: HR_ADMIN,
        role: "HR_ADMIN",
        grantedByUserId: SUPER_ADMIN,
        grantReason: "DEE-747 HR integration fixture",
      },
      {
        id: SUPER_GRANT,
        userId: SUPER_ADMIN,
        role: "SUPER_ADMIN",
        grantedByUserId: SUPER_ADMIN,
        grantReason: "DEE-747 super-admin integration fixture",
      },
    ]);
  }, 120_000);

  afterAll(async () => {
    if (!sqlClient) return;
    await sqlClient.unsafe("RESET ROLE");
    await cleanup();
    await sqlClient.end({ timeout: 5 });
  });

  it("limits an HR admin to the HR module", async () => {
    await expect(
      resolvePermissionPostgres(db, {
        userId: HR_ADMIN,
        organizationId: hrOrgId,
        permission: "admin.hr.read",
      }),
    ).resolves.toMatchObject({ allowed: true });
    await expect(
      resolvePermissionPostgres(db, {
        userId: HR_ADMIN,
        organizationId: hrOrgId,
        permission: "admin.treasury.read",
      }),
    ).resolves.toMatchObject({ allowed: false });
  });

  it("does not extend shared WAIA super-admin authority into AI-TRADER Admin", async () => {
    await expect(
      resolvePermissionPostgres(db, {
        userId: SUPER_ADMIN,
        organizationId: hrOrgId,
        permission: "admin.hr.read",
      }),
    ).resolves.toMatchObject({ allowed: true });
    await expect(
      resolvePermissionPostgres(db, {
        userId: SUPER_ADMIN,
        organizationId: hrOrgId,
        permission: "admin.trader.operations.mutate",
      }),
    ).resolves.toMatchObject({ allowed: false });
  });

  it("creates immutable intake and appends status, assignee and comment history", async () => {
    const created = await createPublicHrApplication({
      db,
      applicantUserId: null,
      authenticatedDisplayName: null,
      body: {
        identityName: "Applicant",
        contactEmail: "dee-747-applicant@waia.invalid",
        targetType: "TASK",
        targetReference: "DEE-747",
        competencies: "Product engineering and secure operations",
        experience: "Ten years building auditable web applications",
        collaborationTerms: "Open to fixed fee or equity",
        context: "Ready to help",
        consent: true,
      },
    });
    applicationId = created.id;
    await mutateHrApplication({
      db,
      actorUserId: HR_ADMIN,
      applicationId,
      body: { command: "assign", assigneeUserId: SUPER_ADMIN },
    });
    await mutateHrApplication({
      db,
      actorUserId: HR_ADMIN,
      applicationId,
      body: { command: "transition", toStatus: "INTERVIEW" },
    });
    await mutateHrApplication({
      db,
      actorUserId: HR_ADMIN,
      applicationId,
      body: { command: "comment", comment: "Intro call scheduled." },
    });
    const listed = await listHrApplications(db);
    const row = listed.applications.find((item) => item.id === applicationId);
    expect(row).toMatchObject({ status: "INTERVIEW", assignedToUserId: SUPER_ADMIN });
    expect(row?.events.map((event) => event.eventType)).toEqual([
      "CREATED",
      "ASSIGNEE_CHANGED",
      "STATUS_CHANGED",
      "COMMENT_ADDED",
    ]);
    await expect(
      db
        .update(pgSchema.hrTeamApplications)
        .set({ identityName: "Tampered" })
        .where(eq(pgSchema.hrTeamApplications.id, applicationId)),
    ).rejects.toThrow(/immutable/i);
    await expect(
      db.insert(pgSchema.hrApplicationEvents).values({
        id: crypto.randomUUID(),
        applicationId,
        actorUserId: HR_ADMIN,
        eventType: "COMMENT_ADDED",
        comment: "Malformed mixed-shape event",
        toStatus: "CONTRACT",
      }),
    ).rejects.toThrow(/hr_application_events_shape/i);
  });

  it("keeps all HR tables behind deny-by-default browser policies", async () => {
    const tables = await sqlClient`
      SELECT tablename, rowsecurity
      FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename IN (
          'waia_admin_module_grants',
          'hr_team_applications',
          'hr_application_events'
        )
      ORDER BY tablename
    `;
    expect(tables).toHaveLength(3);
    expect(tables.every((table) => table.rowsecurity === true)).toBe(true);

    const policies = await sqlClient`
      SELECT tablename, roles, qual, with_check
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename IN (
          'waia_admin_module_grants',
          'hr_team_applications',
          'hr_application_events'
        )
      ORDER BY tablename
    `;
    expect(policies).toHaveLength(3);
    for (const policy of policies) {
      expect(policy.roles).toEqual(expect.arrayContaining(["authenticated", "anon"]));
      expect(policy.qual).toBe("false");
      expect(policy.with_check).toBe("false");
    }
  });
});
