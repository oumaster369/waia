import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import {
  decodeMasterKeyBase64,
  importAesGcmKey,
  unwrapDekWithMasterKey,
  wrapDekWithMasterKey,
} from "@/lib/trader/security/dek-wrap-crypto";
import { MasterKeyConfigError, MasterKeyVersionMismatchError } from "@/lib/trader/security/errors";
import type { MasterKeyProvider, WrappedDataKey } from "@/lib/trader/security/master-key-provider";
import { CURRENT_MASTER_KEY_VERSION } from "@/lib/trader/security/master-key-versions";

function readDevMasterKeyMaterial(): Uint8Array {
  const encoded = process.env.AI_TRADER_MASTER_KEY_DEV?.trim();
  if (!encoded) {
    throw new MasterKeyConfigError(
      "AI_TRADER_MASTER_KEY_DEV is required for DevMasterKeyProvider in local/test environments.",
    );
  }
  return decodeMasterKeyBase64(encoded);
}

export class DevMasterKeyProvider implements MasterKeyProvider {
  private readonly cryptoKey: CryptoKey;

  private constructor(cryptoKey: CryptoKey) {
    this.cryptoKey = cryptoKey;
  }

  static async create(): Promise<DevMasterKeyProvider> {
    const raw = readDevMasterKeyMaterial();
    const cryptoKey = await importAesGcmKey(raw);
    return new DevMasterKeyProvider(cryptoKey);
  }

  getCurrentKeyVersion(): string {
    return CURRENT_MASTER_KEY_VERSION;
  }

  isProductionReady(): boolean {
    return false;
  }

  async encryptDataKey(plaintextDataKey: Uint8Array): Promise<WrappedDataKey> {
    return wrapDekWithMasterKey({
      masterKey: this.cryptoKey,
      plaintextDek: plaintextDataKey,
      keyVersion: this.getCurrentKeyVersion(),
    });
  }

  async decryptDataKey(wrapped: WrappedDataKey): Promise<Uint8Array> {
    if (wrapped.keyVersion !== this.getCurrentKeyVersion()) {
      throw new MasterKeyVersionMismatchError();
    }
    return unwrapDekWithMasterKey({ masterKey: this.cryptoKey, wrapped });
  }
}
