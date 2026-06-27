import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { OrgScopeError } from "@/lib/waia-core/scope/org-context";
import { createSqliteCredentialService } from "@/lib/trader/credentials";
import { CredentialNotFoundError } from "@/lib/trader/credentials/errors";
import { createMasterKeyProvider } from "@/lib/trader/security/create-master-key-provider";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_A = "00000000-0000-4000-8000-00000000a234";
const USER_B = "00000000-0000-4000-8000-00000000b234";

function randomMasterKeyBase64(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64");
}

describe("trader credential tenant isolation (DEE-234 / ADR-0007)", () => {
  let orgA: string;
  let orgB: string;
  let credentialId: string;
  let masterKeyBase64: string;

  beforeAll(async () => {
    masterKeyBase64 = randomMasterKeyBase64();

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-cred-iso-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "credential-isolation.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "cred-iso-a@waia.invalid",
      password: "password123",
      identityLabel: "Credential Org A",
    });
    insertEmailPasswordUser(db, {
      id: USER_B,
      email: "cred-iso-b@waia.invalid",
      password: "password123",
      identityLabel: "Credential Org B",
    });

    orgA = ensureUserCoreSeedSqlite(db, { userId: USER_A, displayName: "Credential Org A" });
    orgB = ensureUserCoreSeedSqlite(db, { userId: USER_B, displayName: "Credential Org B" });

    const service = createSqliteCredentialService(db, {
      createProvider: () =>
        createMasterKeyProvider({
          injectSecretGetter: async () => masterKeyBase64,
          productionReady: true,
        }),
    });

    const stored = await service.storeCredentials(
      { organizationId: orgA },
      {
        venue: "mock",
        exchangeAccountId: "iso-acct-a",
        credentials: { apiKey: "ISO-KEY-ORG-A", apiSecret: "ISO-SECRET-ORG-A" },
      },
    );
    credentialId = stored.id;
  });

  function createService() {
    const db = getDb();
    return createSqliteCredentialService(db, {
      createProvider: () =>
        createMasterKeyProvider({
          injectSecretGetter: async () => masterKeyBase64,
          productionReady: true,
        }),
    });
  }

  it("org B cannot decrypt org A credentials", async () => {
    const service = createService();
    await expect(
      service.getDecryptedCredentials({ organizationId: orgB }, credentialId),
    ).rejects.toBeInstanceOf(CredentialNotFoundError);
  });

  it("org B cannot revoke org A credentials", async () => {
    const service = createService();
    await expect(
      service.revokeCredentials({ organizationId: orgB }, credentialId),
    ).rejects.toBeInstanceOf(CredentialNotFoundError);

    const orgAService = createService();
    const metadata = await orgAService.listCredentialMetadata({ organizationId: orgA });
    expect(metadata.find((row) => row.id === credentialId)?.status).toBe("active");
  });

  it("listCredentialMetadata for org B does not expose org A credentials", async () => {
    const service = createService();
    const orgBRows = await service.listCredentialMetadata({ organizationId: orgB });
    expect(orgBRows).toHaveLength(0);
  });

  it("listCredentialMetadata never returns ciphertext or secrets for org A", async () => {
    const service = createService();
    const orgARows = await service.listCredentialMetadata({ organizationId: orgA });
    const row = orgARows.find((entry) => entry.id === credentialId);

    expect(row).toBeDefined();
    expect(row?.apiKeyMasked).toBe("ISO-…RG-A");
    expect(row).not.toHaveProperty("encryptedPayload");
    expect(row).not.toHaveProperty("wrappedDekKey");
    expect(row).not.toHaveProperty("apiSecret");
    expect(JSON.stringify(row)).not.toContain("ISO-SECRET-ORG-A");
  });

  it("rejects missing organization context", async () => {
    const service = createService();
    await expect(service.listCredentialMetadata({ organizationId: "" })).rejects.toBeInstanceOf(
      OrgScopeError,
    );
  });
});
