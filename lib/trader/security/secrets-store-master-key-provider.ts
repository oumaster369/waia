import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import { MasterKeyConfigError, MasterKeyVersionMismatchError } from "@/lib/trader/security/errors";
import {
  decodeMasterKeyBase64,
  importAesGcmKey,
  unwrapDekWithMasterKey,
  wrapDekWithMasterKey,
} from "@/lib/trader/security/dek-wrap-crypto";
import { isProductionDeployment } from "@/lib/trader/security/deployment-tier";
import type { MasterKeyProvider, WrappedDataKey } from "@/lib/trader/security/master-key-provider";
import { CURRENT_MASTER_KEY_VERSION } from "@/lib/trader/security/master-key-versions";

export type SecretsStoreBinding = {
  get(): Promise<string>;
};

export type SecretsStoreMasterKeyProviderOptions = {
  secretGetter: () => Promise<string>;
  /** When false, provider wraps/unwrapped but isProductionReady() is false (preview/staging/missing config). */
  productionReady: boolean;
  versionKeys?: Map<string, CryptoKey>;
};

async function loadVersionKeys(
  secretGetter: () => Promise<string>,
): Promise<Map<string, CryptoKey>> {
  const raw = decodeMasterKeyBase64(await secretGetter());
  const cryptoKey = await importAesGcmKey(raw);
  return new Map([[CURRENT_MASTER_KEY_VERSION, cryptoKey]]);
}

export class SecretsStoreMasterKeyProvider implements MasterKeyProvider {
  private readonly productionReady: boolean;
  private readonly versionKeys: Map<string, CryptoKey>;

  private constructor(options: SecretsStoreMasterKeyProviderOptions) {
    this.productionReady = options.productionReady;
    this.versionKeys = options.versionKeys ?? new Map();
  }

  static async create(options: {
    secretGetter: () => Promise<string>;
    productionReady?: boolean;
  }): Promise<SecretsStoreMasterKeyProvider> {
    const versionKeys = await loadVersionKeys(options.secretGetter);
    const productionReady = options.productionReady ?? isProductionDeployment();
    return new SecretsStoreMasterKeyProvider({
      secretGetter: options.secretGetter,
      productionReady,
      versionKeys,
    });
  }

  static createNotConfigured(): SecretsStoreMasterKeyProvider {
    return new SecretsStoreMasterKeyProvider({
      secretGetter: async () => {
        throw new MasterKeyConfigError("Secrets Store master key binding is not configured.");
      },
      productionReady: false,
      versionKeys: new Map(),
    });
  }

  getCurrentKeyVersion(): string {
    return CURRENT_MASTER_KEY_VERSION;
  }

  isProductionReady(): boolean {
    return this.productionReady && this.versionKeys.has(CURRENT_MASTER_KEY_VERSION);
  }

  private resolveKeyForVersion(version: string): CryptoKey {
    const key = this.versionKeys.get(version);
    if (!key) {
      throw new MasterKeyVersionMismatchError();
    }
    return key;
  }

  async encryptDataKey(plaintextDataKey: Uint8Array): Promise<WrappedDataKey> {
    const keyVersion = this.getCurrentKeyVersion();
    return wrapDekWithMasterKey({
      masterKey: this.resolveKeyForVersion(keyVersion),
      plaintextDek: plaintextDataKey,
      keyVersion,
    });
  }

  async decryptDataKey(wrapped: WrappedDataKey): Promise<Uint8Array> {
    return unwrapDekWithMasterKey({
      masterKey: this.resolveKeyForVersion(wrapped.keyVersion),
      wrapped,
    });
  }
}
