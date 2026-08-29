/**
 * DEE-779 — authoritative PostgreSQL credential lifecycle negatives.
 * Enable with WAIA_PG_INTEGRATION=1 and DATABASE_URL_POSTGRES.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import postgres from "postgres";

import { getPostgresDrizzle, resetPostgresSingletonForTests } from "@/db/postgres-client";
import * as pgSchema from "@/db/schema.postgres";
import { createPostgresCredentialService } from "@/lib/trader/credentials/credential-service";
import { createMasterKeyProvider } from "@/lib/trader/security/create-master-key-provider";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { seedHtrPostgresUser } from "@/tests/integration/htr-postgres-fixture-prelude";

const enabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();
const USER_A = "00000000-0000-4000-8077-000000077901";
const USER_B = "00000000-0000-4000-8077-000000077902";

function randomMasterKeyBase64(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64");
}

describe.skipIf(!enabled || !url)("postgres HTX credential lifecycle (DEE-779)", () => {
  let orgA: string;
  let orgB: string;
  const masterKey = randomMasterKeyBase64();

  async function cleanup(): Promise<void> {
    const sql = postgres(url!, { max: 1 });
    try {
      for (const userId of [USER_A, USER_B]) {
        const orgId = personalOrganizationIdFromUserId(userId);
        await sql.unsafe(`DELETE FROM audit_logs WHERE organization_id = $1`, [orgId]);
        await sql.unsafe(`DELETE FROM exchange_credentials WHERE organization_id = $1`, [orgId]);
        await sql.unsafe(`DELETE FROM organization_members WHERE organization_id = $1`, [orgId]);
        await sql.unsafe(`DELETE FROM organizations WHERE id = $1`, [orgId]);
        await sql.unsafe(`DELETE FROM user_platform_roles WHERE user_id = $1`, [userId]);
        await sql.unsafe(`DELETE FROM profiles WHERE user_id = $1`, [userId]);
        await sql.unsafe(`DELETE FROM users WHERE id = $1`, [userId]);
        await sql.unsafe(`DELETE FROM auth.users WHERE id = $1`, [userId]);
      }
    } finally {
      await sql.end({ timeout: 5 });
    }
  }

  const createProvider = () =>
    createMasterKeyProvider({
      injectSecretGetter: async () => masterKey,
      productionReady: true,
    });

  beforeAll(async () => {
    await cleanup();
    orgA = await seedHtrPostgresUser(url!, USER_A, "Credential Lifecycle A");
    orgB = await seedHtrPostgresUser(url!, USER_B, "Credential Lifecycle B");
  });

  afterAll(async () => {
    await cleanup();
    resetPostgresSingletonForTests();
  });

  it("admits one concurrent replacement and maps the race loser to conflict", async () => {
    const db = getPostgresDrizzle();
    const service = createPostgresCredentialService(db, { createProvider });
    const prior = await service.storeCredentials(
      { organizationId: orgA },
      {
        venue: "htx",
        exchangeAccountId: "concurrent-replace",
        credentials: { apiKey: "OLD-KEY", apiSecret: "OLD-SECRET" },
      },
    );
    const replace = (suffix: string) => service.storeCredentials(
      { organizationId: orgA },
      {
        venue: "htx",
        exchangeAccountId: "concurrent-replace",
        credentials: { apiKey: `NEW-${suffix}`, apiSecret: `SECRET-${suffix}` },
        expectedActiveCredentialId: prior.id,
      },
    );
    const results = await Promise.allSettled([replace("A"), replace("B")]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({
      reason: { code: "CREDENTIAL_CONFLICT" },
    });
    expect(
      (await service.listCredentialMetadata({ organizationId: orgA })).filter(
        (row) => row.exchangeAccountId === "concurrent-replace" && row.status === "active",
      ),
    ).toHaveLength(1);
  });

  it("makes overlapping revoke retries idempotent with one audit", async () => {
    const db = getPostgresDrizzle();
    const service = createPostgresCredentialService(db, { createProvider });
    const stored = await service.storeCredentials(
      { organizationId: orgA },
      {
        venue: "htx",
        exchangeAccountId: "concurrent-revoke",
        credentials: { apiKey: "REVOKE-KEY", apiSecret: "REVOKE-SECRET" },
      },
    );
    const results = await Promise.all([
      service.revokeCredentials({ organizationId: orgA }, stored.id),
      service.revokeCredentials({ organizationId: orgA }, stored.id),
    ]);
    expect(results.map((row) => row.status)).toEqual(["revoked", "revoked"]);
    const audits = await db
      .select()
      .from(pgSchema.auditLogs)
      .where(
        and(
          eq(pgSchema.auditLogs.organizationId, orgA),
          eq(pgSchema.auditLogs.entityId, stored.id),
          eq(pgSchema.auditLogs.action, "trader.credential.revoked"),
        ),
      );
    expect(audits).toHaveLength(1);
  });

  it("rolls back replacement and revoke when audit append fails", async () => {
    const db = getPostgresDrizzle();
    const ready = createPostgresCredentialService(db, { createProvider });
    const stored = await ready.storeCredentials(
      { organizationId: orgA },
      {
        venue: "htx",
        exchangeAccountId: "pg-audit-rollback",
        credentials: { apiKey: "ROLLBACK-KEY", apiSecret: "ROLLBACK-SECRET" },
      },
    );
    const failing = createPostgresCredentialService(db, {
      createProvider,
      writeAudit: async () => { throw new Error("synthetic audit failure"); },
    });
    await expect(
      failing.storeCredentials(
        { organizationId: orgA },
        {
          venue: "htx",
          exchangeAccountId: "pg-audit-rollback",
          credentials: { apiKey: "NEW-KEY", apiSecret: "NEW-SECRET" },
          expectedActiveCredentialId: stored.id,
        },
      ),
    ).rejects.toThrow("synthetic audit failure");
    expect((await ready.listCredentialMetadata({ organizationId: orgA })).find((row) => row.id === stored.id)?.status)
      .toBe("active");
    await expect(
      failing.revokeCredentials({ organizationId: orgA }, stored.id),
    ).rejects.toThrow("synthetic audit failure");
    expect((await ready.listCredentialMetadata({ organizationId: orgA })).find((row) => row.id === stored.id)?.status)
      .toBe("active");
  });

  it("rolls back PostgreSQL revoke when replacement insert conflicts", async () => {
    const service = createPostgresCredentialService(getPostgresDrizzle(), { createProvider });
    const stored = await service.storeCredentials(
      { organizationId: orgA },
      {
        venue: "htx",
        exchangeAccountId: "pg-insert-rollback",
        credentials: { apiKey: "INSERT-OLD", apiSecret: "INSERT-OLD-SECRET" },
      },
    );
    const uuidSpy = vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(stored.id);
    try {
      await expect(
        service.storeCredentials(
          { organizationId: orgA },
          {
            venue: "htx",
            exchangeAccountId: "pg-insert-rollback",
            credentials: { apiKey: "INSERT-NEW", apiSecret: "INSERT-NEW-SECRET" },
            expectedActiveCredentialId: stored.id,
          },
        ),
      ).rejects.toThrow();
    } finally {
      uuidSpy.mockRestore();
    }
    expect((await service.listCredentialMetadata({ organizationId: orgA })).find((row) => row.id === stored.id)?.status)
      .toBe("active");
  });

  it("does not reveal an existing other-tenant credential", async () => {
    const service = createPostgresCredentialService(getPostgresDrizzle(), { createProvider });
    const stored = await service.storeCredentials(
      { organizationId: orgA },
      {
        venue: "htx",
        exchangeAccountId: "tenant-hidden",
        credentials: { apiKey: "TENANT-A-KEY", apiSecret: "TENANT-A-SECRET" },
      },
    );
    await expect(
      service.revokeCredentials({ organizationId: orgB }, stored.id),
    ).rejects.toMatchObject({ code: "CREDENTIAL_NOT_FOUND" });
  });
});
