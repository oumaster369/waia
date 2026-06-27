import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMasterKeyProvider } from "@/lib/trader/security/create-master-key-provider";
import { assertCredentialStorageAllowed } from "@/lib/trader/security/credential-storage-gate";
import { DEK_BYTE_LENGTH } from "@/lib/trader/security/dek-wrap-crypto";
import { DevMasterKeyProvider } from "@/lib/trader/security/dev-master-key-provider";
import {
  MASTER_KEY_ERROR_CODES,
  MasterKeyConfigError,
  MasterKeyDecryptError,
  MasterKeyInvalidDekError,
  MasterKeyNotReadyError,
} from "@/lib/trader/security/errors";
import { generateDataKey } from "@/lib/trader/security/master-key-provider";
import { SecretsStoreMasterKeyProvider } from "@/lib/trader/security/secrets-store-master-key-provider";

const TEST_MASTER_KEY_B64 = Buffer.alloc(32, 7).toString("base64");

function restoreEnv(keys: string[]): void {
  for (const key of keys) {
    delete process.env[key];
  }
}

describe("trader MasterKeyProvider (DEE-220)", () => {
  const envKeys = [
    "AI_TRADER_MASTER_KEY_DEV",
    "AI_TRADER_MASTER_KEY_MODE",
    "WAIA_DEPLOYMENT_TIER",
    "CF_ENVIRONMENT",
  ];

  beforeEach(() => {
    process.env.AI_TRADER_MASTER_KEY_DEV = TEST_MASTER_KEY_B64;
    delete process.env.AI_TRADER_MASTER_KEY_MODE;
    delete process.env.WAIA_DEPLOYMENT_TIER;
    delete process.env.CF_ENVIRONMENT;
  });

  afterEach(() => {
    restoreEnv(envKeys);
    vi.restoreAllMocks();
  });

  it("round-trips DEK wrap/unwrap via SecretsStoreMasterKeyProvider", async () => {
    const provider = await SecretsStoreMasterKeyProvider.create({
      secretGetter: async () => TEST_MASTER_KEY_B64,
      productionReady: true,
    });

    const dek = new Uint8Array(DEK_BYTE_LENGTH);
    crypto.getRandomValues(dek);
    const wrapped = await provider.encryptDataKey(dek);
    const recovered = await provider.decryptDataKey(wrapped);

    expect(wrapped.keyVersion).toBe("v1");
    expect(Buffer.from(recovered).equals(Buffer.from(dek))).toBe(true);
  });

  it("generateDataKey produces matching plaintext and wrapped DEK", async () => {
    const provider = await DevMasterKeyProvider.create();
    const { plaintext, wrapped } = await generateDataKey(provider);
    const recovered = await provider.decryptDataKey(wrapped);
    expect(recovered).toEqual(plaintext);
  });

  it("rejects DEK length !== 32 on encrypt", async () => {
    const provider = await DevMasterKeyProvider.create();
    await expect(provider.encryptDataKey(new Uint8Array(16))).rejects.toThrow(
      MasterKeyInvalidDekError,
    );
  });

  it("throws MasterKeyVersionMismatchError for unknown version on decrypt", async () => {
    const provider = await SecretsStoreMasterKeyProvider.create({
      secretGetter: async () => TEST_MASTER_KEY_B64,
    });
    const dek = new Uint8Array(DEK_BYTE_LENGTH);
    crypto.getRandomValues(dek);
    const wrapped = await provider.encryptDataKey(dek);

    await expect(provider.decryptDataKey({ ...wrapped, keyVersion: "v99" })).rejects.toMatchObject({
      code: MASTER_KEY_ERROR_CODES.VERSION_MISMATCH,
    });
  });

  it("throws MasterKeyDecryptError on corrupt wrapped blob", async () => {
    const provider = await DevMasterKeyProvider.create();
    await expect(
      provider.decryptDataKey({ keyVersion: "v1", wrappedKey: Buffer.alloc(8).toString("base64") }),
    ).rejects.toThrow(MasterKeyDecryptError);
  });

  it("DevMasterKeyProvider is never production-ready", async () => {
    const provider = await DevMasterKeyProvider.create();
    expect(provider.isProductionReady()).toBe(false);
    expect(() => assertCredentialStorageAllowed(provider)).toThrow(MasterKeyNotReadyError);
  });

  it("preview deployment excludes production-ready even with binding", async () => {
    process.env.WAIA_DEPLOYMENT_TIER = "preview";
    const provider = await createMasterKeyProvider({
      injectSecretGetter: async () => TEST_MASTER_KEY_B64,
    });
    expect(provider.isProductionReady()).toBe(false);
  });

  it("production deployment with injectSecretGetter can be production-ready", async () => {
    process.env.WAIA_DEPLOYMENT_TIER = "production";
    const provider = await createMasterKeyProvider({
      injectSecretGetter: async () => TEST_MASTER_KEY_B64,
    });
    expect(provider.isProductionReady()).toBe(true);
    expect(() => assertCredentialStorageAllowed(provider)).not.toThrow();
  });

  it("throws MasterKeyConfigError when dev mode is set on production deployment", async () => {
    process.env.WAIA_DEPLOYMENT_TIER = "production";
    process.env.AI_TRADER_MASTER_KEY_MODE = "dev";
    await expect(
      createMasterKeyProvider({ injectSecretGetter: async () => TEST_MASTER_KEY_B64 }),
    ).rejects.toThrow(MasterKeyConfigError);
  });

  it("production without binding returns not-ready SecretsStore provider", async () => {
    process.env.WAIA_DEPLOYMENT_TIER = "production";
    const provider = await createMasterKeyProvider();
    expect(provider).toBeInstanceOf(SecretsStoreMasterKeyProvider);
    expect(provider.isProductionReady()).toBe(false);
  });

  it("local environment uses DevMasterKeyProvider when no binding", async () => {
    const provider = await createMasterKeyProvider();
    expect(provider).toBeInstanceOf(DevMasterKeyProvider);
  });
});
