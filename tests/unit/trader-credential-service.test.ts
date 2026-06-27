import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import { auditLogs } from "@/db/schema";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import {
  createSqliteCredentialService,
  decryptCredentialPayload,
  encryptCredentialPayload,
  maskApiKey,
} from "@/lib/trader/credentials";
import { DevMasterKeyProvider } from "@/lib/trader/security/dev-master-key-provider";
import { createMasterKeyProvider } from "@/lib/trader/security/create-master-key-provider";
import { credentialPayloadAad, dekWrapAad } from "@/lib/trader/security/index";
import { MasterKeyNotReadyError } from "@/lib/trader/security/errors";
import { traderAuditActions, traderEntityTypes } from "@/lib/trader/types";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_ID = "00000000-0000-4000-8000-00000000d234";

function randomMasterKeyBase64(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64");
}

describe("trader credential service (DEE-234)", () => {
  let organizationId: string;
  let masterKeyBase64: string;

  beforeAll(() => {
    masterKeyBase64 = randomMasterKeyBase64();
    process.env.AI_TRADER_MASTER_KEY_DEV = masterKeyBase64;

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-cred-svc-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "credential-service.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_ID,
      email: "cred-svc@waia.invalid",
      password: "password123",
      identityLabel: "Credential Service User",
    });
    organizationId = ensureUserCoreSeedSqlite(db, {
      userId: USER_ID,
      displayName: "Credential Service User",
    });
  });

  async function createReadyProvider() {
    return createMasterKeyProvider({
      injectSecretGetter: async () => masterKeyBase64,
      productionReady: true,
    });
  }

  async function createService() {
    const db = getDb();
    return createSqliteCredentialService(db, {
      createProvider: () => createReadyProvider(),
    });
  }

  it("encryptCredentialPayload round-trips synthetic credentials", async () => {
    const provider = await createReadyProvider();
    const credentials = {
      apiKey: "SYNTHETIC-API-KEY-001",
      apiSecret: "SYNTHETIC-API-SECRET-001",
    };

    const encrypted = await encryptCredentialPayload(provider, credentials);
    const row = {
      id: "test-id",
      organizationId,
      venue: "mock",
      exchangeAccountId: "acct-1",
      apiKeyMasked: null,
      encryptedPayload: encrypted.encryptedPayload,
      payloadKeyVersion: encrypted.payloadKeyVersion,
      wrappedDekKeyVersion: encrypted.wrappedDekKeyVersion,
      wrappedDekKey: encrypted.wrappedDekKey,
      permissionMetadata: null,
      status: "active" as const,
      createdAt: new Date(),
      updatedAt: new Date(),
      revokedAt: null,
    };

    const decrypted = await decryptCredentialPayload(provider, row);
    expect(decrypted).toEqual(credentials);
  });

  it("decrypt fails when encrypted payload is tampered", async () => {
    const provider = await createReadyProvider();
    const encrypted = await encryptCredentialPayload(provider, {
      apiKey: "TAMPER-KEY",
      apiSecret: "TAMPER-SECRET",
    });

    const blob = Buffer.from(encrypted.encryptedPayload, "base64");
    blob[blob.length - 1] ^= 0xff;

    await expect(
      decryptCredentialPayload(provider, {
        id: "test-id",
        organizationId,
        venue: "mock",
        exchangeAccountId: "acct-1",
        apiKeyMasked: null,
        encryptedPayload: blob.toString("base64"),
        payloadKeyVersion: encrypted.payloadKeyVersion,
        wrappedDekKeyVersion: encrypted.wrappedDekKeyVersion,
        wrappedDekKey: encrypted.wrappedDekKey,
        permissionMetadata: null,
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
        revokedAt: null,
      }),
    ).rejects.toMatchObject({ code: "CREDENTIAL_DECRYPT_FAILED" });
  });

  it("uses credentialPayloadAad distinct from dekWrapAad", () => {
    expect(credentialPayloadAad("v1")).toBe("waia:trader:cred:v1");
    expect(dekWrapAad("v1")).toBe("waia:trader:dek-wrap:v1");
    expect(credentialPayloadAad("v1")).not.toBe(dekWrapAad("v1"));
  });

  it("maskApiKey masks long keys and fully masks short keys", () => {
    expect(maskApiKey("ABCDEFGH12345678")).toBe("ABCD…5678");
    expect(maskApiKey("short")).toBe("••••");
  });

  it("storeCredentials persists ciphertext and writes created audit", async () => {
    const service = await createService();
    const credentials = {
      apiKey: "STORE-KEY-0001",
      apiSecret: "STORE-SECRET-0001",
    };

    const metadata = await service.storeCredentials(
      { organizationId },
      {
        venue: "mock",
        exchangeAccountId: "store-acct-1",
        credentials,
        permissionMetadata: { read: true },
        actorType: "service",
        actorId: "test-runner",
      },
    );

    expect(metadata.apiKeyMasked).toBe(maskApiKey(credentials.apiKey));
    expect(metadata.status).toBe("active");
    expect(metadata).not.toHaveProperty("encryptedPayload");
    expect(metadata).not.toHaveProperty("apiSecret");

    const db = getDb();
    const auditRow = db
      .select({
        action: auditLogs.action,
        entityType: auditLogs.entityType,
        entityId: auditLogs.entityId,
        organizationId: auditLogs.organizationId,
        metadataJson: auditLogs.metadataJson,
      })
      .from(auditLogs)
      .where(eq(auditLogs.entityId, metadata.id))
      .all()[0];

    expect(auditRow).toMatchObject({
      action: traderAuditActions.credentialCreated,
      entityType: traderEntityTypes.exchangeCredential,
      organizationId,
    });
    expect(auditRow?.metadataJson).not.toContain(credentials.apiKey);
    expect(auditRow?.metadataJson).not.toContain(credentials.apiSecret);
  });

  it("replace revokes prior active row and writes rotated audit", async () => {
    const service = await createService();
    const first = await service.storeCredentials(
      { organizationId },
      {
        venue: "mock",
        exchangeAccountId: "rotate-acct-1",
        credentials: { apiKey: "ROTATE-KEY-001", apiSecret: "ROTATE-SECRET-001" },
      },
    );

    const second = await service.storeCredentials(
      { organizationId },
      {
        venue: "mock",
        exchangeAccountId: "rotate-acct-1",
        credentials: { apiKey: "ROTATE-KEY-002", apiSecret: "ROTATE-SECRET-002" },
      },
    );

    const listed = await service.listCredentialMetadata({ organizationId });
    const active = listed.filter(
      (row) =>
        row.venue === "mock" &&
        row.exchangeAccountId === "rotate-acct-1" &&
        row.status === "active",
    );
    const revoked = listed.filter(
      (row) =>
        row.venue === "mock" &&
        row.exchangeAccountId === "rotate-acct-1" &&
        row.status === "revoked",
    );

    expect(active).toHaveLength(1);
    expect(active[0]?.id).toBe(second.id);
    expect(revoked.some((row) => row.id === first.id)).toBe(true);

    const db = getDb();
    const auditRow = db
      .select({ action: auditLogs.action, metadataJson: auditLogs.metadataJson })
      .from(auditLogs)
      .where(eq(auditLogs.entityId, second.id))
      .all()
      .find((row) => row.action === traderAuditActions.credentialRotated);

    expect(auditRow).toBeDefined();
    expect(auditRow?.metadataJson).toContain(first.id);
  });

  it("getDecryptedCredentials returns plaintext for owning org", async () => {
    const service = await createService();
    const stored = await service.storeCredentials(
      { organizationId },
      {
        venue: "mock",
        exchangeAccountId: "decrypt-acct-1",
        credentials: { apiKey: "DECRYPT-KEY", apiSecret: "DECRYPT-SECRET" },
      },
    );

    const decrypted = await service.getDecryptedCredentials({ organizationId }, stored.id);
    expect(decrypted).toEqual({ apiKey: "DECRYPT-KEY", apiSecret: "DECRYPT-SECRET" });
  });

  it("revokeCredentials soft-revokes and writes revoked audit", async () => {
    const service = await createService();
    const stored = await service.storeCredentials(
      { organizationId },
      {
        venue: "mock",
        exchangeAccountId: "revoke-acct-1",
        credentials: { apiKey: "REVOKE-KEY", apiSecret: "REVOKE-SECRET" },
      },
    );

    const revoked = await service.revokeCredentials({ organizationId }, stored.id);
    expect(revoked.status).toBe("revoked");
    expect(revoked.revokedAt).toBeInstanceOf(Date);

    const db = getDb();
    const auditRow = db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(eq(auditLogs.entityId, stored.id))
      .all()
      .find((row) => row.action === traderAuditActions.credentialRevoked);

    expect(auditRow).toBeDefined();
  });

  it("storeCredentials throws MasterKeyNotReadyError when provider is not production-ready", async () => {
    const db = getDb();
    const service = createSqliteCredentialService(db, {
      createProvider: () => DevMasterKeyProvider.create(),
    });

    await expect(
      service.storeCredentials(
        { organizationId },
        {
          venue: "mock",
          exchangeAccountId: "gate-acct-1",
          credentials: { apiKey: "GATE-KEY", apiSecret: "GATE-SECRET" },
        },
      ),
    ).rejects.toBeInstanceOf(MasterKeyNotReadyError);
  });

  it("getDecryptedCredentials throws MasterKeyNotReadyError when provider is not production-ready", async () => {
    const readyService = await createService();
    const stored = await readyService.storeCredentials(
      { organizationId },
      {
        venue: "mock",
        exchangeAccountId: "decrypt-gate-acct-1",
        credentials: { apiKey: "DECRYPT-GATE-KEY", apiSecret: "DECRYPT-GATE-SECRET" },
      },
    );

    const db = getDb();
    const notReadyService = createSqliteCredentialService(db, {
      createProvider: () => DevMasterKeyProvider.create(),
    });

    await expect(
      notReadyService.getDecryptedCredentials({ organizationId }, stored.id),
    ).rejects.toBeInstanceOf(MasterKeyNotReadyError);
  });
});
